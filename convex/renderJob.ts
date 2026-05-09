import { v }                from "convex/values";
import { ConvexError }      from "convex/values";
import {
  query,
  mutation,
  internalMutation,
}                           from "./_generated/server";
import { internal }         from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Id }          from "./_generated/dataModel";

// ─────────────────────────────────────────────────────────────────────────────
// ARCHITECTURE NOTE
// ─────────────────────────────────────────────────────────────────────────────
//
// Python backend is stateless and in-memory. It does NOT call back into Convex.
//
// The render flow is:
//
//   1. UI calls createRenderJob  (Convex mutation)
//      → creates renderJob row (status: "queued")
//      → advances project:     audio_ready → rendering
//      → returns { jobId, pythonProjectId }
//
//   2. UI calls Python directly:
//      POST /projects/{pythonProjectId}/render  { scene_map: {...} }
//      → Python starts render in a background thread → 202 Accepted
//
//   3. UI calls markRenderingStarted (Convex mutation)
//      → job status: queued → rendering
//
//   4. UI streams progress from Python:
//      GET /projects/{pythonProjectId}/render/stream  (SSE)
//      OR GET /projects/{pythonProjectId}/render      (polling every N sec)
//      Progress lives in Python memory only during this phase.
//
//   5. Python reports done / error →  UI calls:
//      completeRenderJob  → Convex records result, project → done
//      failRenderJob      → Convex records error,  project → error
//
//   6. Cancel flow:
//      UI calls cancelRenderJob  (Convex mutation)
//      UI calls Python: DELETE /projects/{pythonProjectId}/render
//      Both must happen — Convex records the cancellation,
//      Python stops the thread.
//
// Convex  = source of truth for PROJECT STATE (persistent).
// Python  = source of truth for RENDER PROGRESS (in-memory, mid-flight only).
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function assertJobExists(
  ctx:   MutationCtx,
  jobId: Id<"renderJobs">,
) {
  const job = await ctx.db.get(jobId);
  if (!job) throw new ConvexError("Render job not found.");
  return job;
}

async function assertJobActive(
  ctx:   MutationCtx,
  jobId: Id<"renderJobs">,
) {
  const job = await assertJobExists(ctx, jobId);
  if (job.status !== "queued" && job.status !== "rendering") {
    throw new ConvexError(
      `Job is not active (status: "${job.status}"). ` +
      `Only queued or rendering jobs can be modified.`,
    );
  }
  return job;
}

async function getActiveJobForProject(
  ctx:       MutationCtx,
  projectId: Id<"projects">,
) {
  const queued = await ctx.db
    .query("renderJobs")
    .withIndex("by_project_status", q =>
      q.eq("projectId", projectId).eq("status", "queued"),
    )
    .first();
  if (queued) return queued;

  const rendering = await ctx.db
    .query("renderJobs")
    .withIndex("by_project_status", q =>
      q.eq("projectId", projectId).eq("status", "rendering"),
    )
    .first();
  return rendering ?? null;
}


// ─────────────────────────────────────────────────────────────────────────────
// READS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getLatestRenderJob
 * Most recent render job for a project. The canonical job the UI shows.
 * Returns null if no jobs exist yet.
 */
export const getLatestRenderJob = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    return await ctx.db
      .query("renderJobs")
      .withIndex("by_project_created", q => q.eq("projectId", projectId))
      .order("desc")
      .first();
  },
});

/**
 * listRenderJobs
 * Full render history for a project, newest first.
 */
export const listRenderJobs = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    return await ctx.db
      .query("renderJobs")
      .withIndex("by_project_created", q => q.eq("projectId", projectId))
      .order("desc")
      .collect();
  },
});

/**
 * getRenderProgress
 * Lightweight query for the render panel.
 *
 * IMPORTANT: mid-flight progress (0–99%) comes from Python SSE directly,
 * not from this query. This query shows the FINAL recorded state only.
 * Use it to:
 *   - Show the last known state on page load
 *   - Confirm completion/failure after SSE closes
 *   - Power the render history list
 */
export const getRenderProgress = query({
  args: { jobId: v.id("renderJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;

    return {
      _id:             job._id,
      status:          job.status,
      progress:        job.progress,
      errorMessage:    job.errorMessage,
      errorStage:      job.errorStage,
      outputUrl:       job.outputUrl,
      fileSizeBytes:   job.fileSizeBytes,
      durationSecs:    job.durationSecs,
      startedAt:       job.startedAt,
      finishedAt:      job.finishedAt,
      renderTimeSecs:  job.renderTimeSecs,
      // Expose so UI can construct Python API URLs:
      // GET /projects/{pythonProjectId}/render/stream
      // GET /projects/{pythonProjectId}/render/download
      pythonProjectId: job.externalJobId,
    };
  },
});


// ─────────────────────────────────────────────────────────────────────────────
// WRITES — PUBLIC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * createRenderJob
 * Step 1 of the render flow.
 *
 * Creates the Convex job row, advances project status.
 * Does NOT talk to Python — caller does that after this returns.
 *
 * pythonProjectId = the Convex projectId string, used as Python's project_id.
 * This keeps the mapping trivial: one ID, two systems, no translation needed.
 *
 * Returns: { jobId, pythonProjectId }
 * Caller uses pythonProjectId to call:
 *   POST /projects/{pythonProjectId}/render
 */
export const createRenderJob = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project)          throw new ConvexError("Project not found.");
    if (project.deletedAt) throw new ConvexError("Project has been deleted.");

    if (project.status !== "audio_ready") {
      throw new ConvexError(
        `Project must be "audio_ready" to start a render. ` +
        `Current status: "${project.status}".`,
      );
    }

    const activeJob = await getActiveJobForProject(ctx, projectId);
    if (activeJob) {
      throw new ConvexError(
        `A render job is already ${activeJob.status} for this project. ` +
        `Cancel it before starting a new one.`,
      );
    }

    const now             = Date.now();
    const pythonProjectId = projectId as string;

    const jobId = await ctx.db.insert("renderJobs", {
      projectId,
      renderConfig:  project.render,   // snapshot at job creation
      status:        "queued",
      progress:      0,
      externalJobId: pythonProjectId,  // Python API project_id
      // No callbackSecret — Python does not call back into Convex
      startedAt:  now,
      createdAt:  now,
      updatedAt:  now,
    });

    // Project: audio_ready → rendering
    await ctx.runMutation(internal.projects.setRenderingInternal, {
      projectId,
    });

    return { jobId, pythonProjectId };
  },
});

/**
 * markRenderingStarted
 * Step 3 — called after Python returns 202 Accepted.
 * Moves job: queued → rendering.
 * Idempotent — safe to call if already rendering.
 */
export const markRenderingStarted = mutation({
  args: { jobId: v.id("renderJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await assertJobExists(ctx, jobId);
    if (job.status !== "queued") return jobId;

    await ctx.db.patch(jobId, {
      status:    "rendering",
      updatedAt: Date.now(),
    });
    return jobId;
  },
});

/**
 * completeRenderJob
 * Step 5a — called by UI after Python SSE/poll reports status: "done".
 *
 * outputUrl: local path Python saved the video to
 *   e.g. "/Users/you/Documents/VidFlow/{projectId}/output.mp4"
 *   Also available via Python's download endpoint:
 *   GET /projects/{pythonProjectId}/render/download
 *
 * fileSizeBytes + durationSecs come from Python's final status response.
 * renderTimeSecs is calculated here from startedAt.
 */
export const completeRenderJob = mutation({
  args: {
    jobId:         v.id("renderJobs"),
    projectId:     v.id("projects"),
    outputUrl:     v.string(),
    fileSizeBytes: v.optional(v.number()),
    durationSecs:  v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await assertJobExists(ctx, args.jobId);
    if (job.status === "done") return args.jobId; // idempotent

    if (job.status !== "queued" && job.status !== "rendering") {
      throw new ConvexError(
        `Cannot complete job with status "${job.status}".`,
      );
    }

    const now            = Date.now();
    const renderTimeSecs = job.startedAt
      ? (now - job.startedAt) / 1000
      : undefined;

    await ctx.db.patch(args.jobId, {
      status:         "done",
      progress:       100,
      outputUrl:      args.outputUrl,
      fileSizeBytes:  args.fileSizeBytes,
      durationSecs:   args.durationSecs,
      finishedAt:     now,
      renderTimeSecs,
      updatedAt:      now,
    });

    // Project: rendering → done
    await ctx.runMutation(internal.projects.internalSetRenderDone, {
      projectId:          args.projectId,
      outputUrl:          args.outputUrl,
      outputSizeBytes:    args.fileSizeBytes,
      outputDurationSecs: args.durationSecs,
    });

    return args.jobId;
  },
});

/**
 * failRenderJob
 * Step 5b — called by UI after Python SSE/poll reports status: "error",
 * OR when the POST /render itself fails (network error, 5xx, 409, etc.).
 *
 * Idempotent — safe to call multiple times (e.g. on network retry).
 */
export const failRenderJob = mutation({
  args: {
    jobId:        v.id("renderJobs"),
    projectId:    v.id("projects"),
    errorMessage: v.string(),
    errorStage:   v.union(
      v.literal("audio"),
      v.literal("scene_map"),
      v.literal("render"),
    ),
  },
  handler: async (ctx, args) => {
    const job = await assertJobExists(ctx, args.jobId);

    // Idempotent — don't overwrite a terminal state
    if (
      job.status === "error"     ||
      job.status === "cancelled" ||
      job.status === "done"
    ) {
      return args.jobId;
    }

    const now            = Date.now();
    const renderTimeSecs = job.startedAt
      ? (now - job.startedAt) / 1000
      : undefined;

    await ctx.db.patch(args.jobId, {
      status:         "error",
      errorMessage:   args.errorMessage,
      errorStage:     args.errorStage,
      finishedAt:     now,
      renderTimeSecs,
      updatedAt:      now,
    });

    // Project: rendering → error
    await ctx.runMutation(internal.projects.internalSetError, {
      projectId:    args.projectId,
      errorStage:   args.errorStage,
      errorMessage: args.errorMessage,
    });

    return args.jobId;
  },
});

/**
 * cancelRenderJob
 * Called by the UI cancel button.
 *
 * Updates Convex only. The UI must ALSO call Python separately:
 *   DELETE /projects/{pythonProjectId}/render
 *
 * After this, project moves to error/render so "Retry Render"
 * (projects.resetToAudioReady) is available.
 */
export const cancelRenderJob = mutation({
  args: {
    jobId:     v.id("renderJobs"),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await assertJobActive(ctx, args.jobId);

    const now = Date.now();

    await ctx.db.patch(args.jobId, {
      status:     "cancelled",
      finishedAt: now,
      updatedAt:  now,
    });

    // Project: rendering → error/render (enables resetToAudioReady)
    await ctx.runMutation(internal.projects.internalSetError, {
      projectId:    args.projectId,
      errorStage:   "render",
      errorMessage: "Render cancelled by user.",
    });

    return args.jobId;
  },
});


// ─────────────────────────────────────────────────────────────────────────────
// WRITES — INTERNAL
// Reserved for future use if Python callbacks are ever added (http.ts).
// Mirrors the public mutations but callable from other Convex functions.
// ─────────────────────────────────────────────────────────────────────────────

export const internalCompleteRenderJob = internalMutation({
  args: {
    jobId:         v.id("renderJobs"),
    projectId:     v.id("projects"),
    outputUrl:     v.string(),
    fileSizeBytes: v.optional(v.number()),
    durationSecs:  v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await assertJobExists(ctx, args.jobId);
    if (job.status === "done") return args.jobId;

    const now            = Date.now();
    const renderTimeSecs = job.startedAt
      ? (now - job.startedAt) / 1000
      : undefined;

    await ctx.db.patch(args.jobId, {
      status:         "done",
      progress:       100,
      outputUrl:      args.outputUrl,
      fileSizeBytes:  args.fileSizeBytes,
      durationSecs:   args.durationSecs,
      finishedAt:     now,
      renderTimeSecs,
      updatedAt:      now,
    });

    await ctx.runMutation(internal.projects.internalSetRenderDone, {
      projectId:          args.projectId,
      outputUrl:          args.outputUrl,
      outputSizeBytes:    args.fileSizeBytes,
      outputDurationSecs: args.durationSecs,
    });

    return args.jobId;
  },
});

export const internalFailRenderJob = internalMutation({
  args: {
    jobId:        v.id("renderJobs"),
    projectId:    v.id("projects"),
    errorMessage: v.string(),
    errorStage:   v.union(
      v.literal("audio"),
      v.literal("scene_map"),
      v.literal("render"),
    ),
  },
  handler: async (ctx, args) => {
    const job = await assertJobExists(ctx, args.jobId);

    if (
      job.status === "error"     ||
      job.status === "cancelled" ||
      job.status === "done"
    ) {
      return args.jobId;
    }

    const now            = Date.now();
    const renderTimeSecs = job.startedAt
      ? (now - job.startedAt) / 1000
      : undefined;

    await ctx.db.patch(args.jobId, {
      status:         "error",
      errorMessage:   args.errorMessage,
      errorStage:     args.errorStage,
      finishedAt:     now,
      renderTimeSecs,
      updatedAt:      now,
    });

    await ctx.runMutation(internal.projects.internalSetError, {
      projectId:    args.projectId,
      errorStage:   args.errorStage,
      errorMessage: args.errorMessage,
    });

    return args.jobId;
  },
});