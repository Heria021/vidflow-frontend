import { v }                  from "convex/values";
import { ConvexError }         from "convex/values";
import {
  query,
  mutation,
  internalMutation,
}                              from "./_generated/server";
import { internal }            from "./_generated/api";
import type { MutationCtx }    from "./_generated/server";
import type { Id }             from "./_generated/dataModel";

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATORS
// ─────────────────────────────────────────────────────────────────────────────

const voiceConfigV = v.object({
  voiceName:    v.string(),
  voiceModel:   v.string(),
  languageCode: v.string(),
  speakingRate: v.number(),
  pitch:        v.number(),
  volumeGainDb: v.number(),
  encoding:     v.union(
    v.literal("MP3"),
    v.literal("LINEAR16"),
    v.literal("OGG_OPUS"),
  ),
});

const renderConfigV = v.object({
  resolution: v.union(v.literal("720p"), v.literal("1080p"), v.literal("4K")),
  fps:        v.union(v.literal(24), v.literal(30), v.literal(60)),
  format:     v.union(v.literal("mp4"), v.literal("webm")),
});

// All valid project statuses in one place.
// Used by assertProjectEditable + assertPipelineIdle.
const PIPELINE_RUNNING_STATUSES = new Set([
  "audio_pending",
  "scene_map_pending",
  "rendering",
] as const);

const EDITABLE_STATUSES = new Set([
  "draft",
  "error",
] as const);


// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// Plain TypeScript — not exported as Convex functions.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * assertProjectExists
 * Fetches and returns the project doc or throws if not found / soft-deleted.
 */
async function assertProjectExists(
  ctx:       MutationCtx,
  projectId: Id<"projects">,
) {
  const project = await ctx.db.get(projectId);
  if (!project)            throw new ConvexError("Project not found.");
  if (project.deletedAt)   throw new ConvexError("Project has been deleted.");
  return project;
}

/**
 * assertProjectEditable
 * Throws if the project is mid-pipeline — protects voice/render/script edits
 * from racing with an active audio or render job.
 * Allowed statuses: "draft" | "error"
 */
async function assertProjectEditable(
  ctx:       MutationCtx,
  projectId: Id<"projects">,
) {
  const project = await assertProjectExists(ctx, projectId);
  if (!EDITABLE_STATUSES.has(project.status as any)) {
    throw new ConvexError(
      `Project cannot be edited in status "${project.status}". ` +
      `Only draft or error projects are editable.`,
    );
  }
  return project;
}

/**
 * assertPipelineIdle
 * Throws if a pipeline stage is actively running.
 * Used by deleteProject to prevent tearing a running pipeline.
 * Running statuses: "audio_pending" | "scene_map_pending" | "rendering"
 */
async function assertPipelineIdle(
  ctx:       MutationCtx,
  projectId: Id<"projects">,
) {
  const project = await assertProjectExists(ctx, projectId);
  if (PIPELINE_RUNNING_STATUSES.has(project.status as any)) {
    throw new ConvexError(
      `Cannot perform this action while the pipeline is running ` +
      `(status: "${project.status}").`,
    );
  }
  return project;
}

/**
 * transitionStatus
 * The single place where project status is written.
 * Patches the project + calls the internal statusLog mutation.
 * Every pipeline mutation routes through here — never patch status directly.
 */
async function transitionStatus(
  ctx:        MutationCtx,
  projectId:  Id<"projects">,
  toStatus:   string,
  opts?: {
    fromStatus?:  string;
    triggeredBy?: "user" | "system" | "renderer";
    note?:        string;
    extraPatch?:  Record<string, unknown>;
  },
) {
  const now = Date.now();

  await ctx.db.patch(projectId, {
    status:    toStatus as any,
    updatedAt: now,
    ...(opts?.extraPatch ?? {}),
  });

  await ctx.runMutation(internal.statuslog.logTransition, {
    projectId,
    fromStatus:  opts?.fromStatus,
    toStatus,
    triggeredBy: opts?.triggeredBy ?? "system",
    note:        opts?.note,
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// APP LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * hasAnyProject
 * Gate query for the per-channel empty state.
 * Returns true if at least one non-deleted project exists in this channel.
 */
export const hasAnyProject = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_channel_active", q =>
        q.eq("channelId", channelId).eq("deletedAt", undefined),
      )
      .first();
    return project !== null;
  },
});


// ─────────────────────────────────────────────────────────────────────────────
// READS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * listProjects
 * All non-deleted projects for a channel, newest first.
 * Returns lightweight docs — no scenes, no render jobs attached.
 * The status badge + progress counters are included (imagesConfirmed / totalImages).
 */
export const listProjects = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_channel_created", q => q.eq("channelId", channelId))
      .filter(q => q.eq(q.field("deletedAt"), undefined))
      .order("desc")
      .collect();
  },
});

/**
 * getProject
 * Single project by _id. Full doc. Returns null if not found or deleted.
 */
export const getProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project || project.deletedAt) return null;
    return project;
  },
});

/**
 * getProjectStatus
 * Lightweight reactive query for the pipeline progress bar.
 * Returns only the fields needed to drive status UI —
 * avoids re-rendering the whole project page on every heartbeat.
 *
 * Shape: { status, errorStage, errorMessage, totalImages, imagesConfirmed }
 */
export const getProjectStatus = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project || project.deletedAt) return null;

    return {
      _id:             project._id,
      status:          project.status,
      errorStage:      project.errorStage,
      errorMessage:    project.errorMessage,
      totalImages:     project.totalImages,
      imagesConfirmed: project.imagesConfirmed,
    };
  },
});


// ─────────────────────────────────────────────────────────────────────────────
// WRITES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * createProject
 * Creates a project under a channel.
 * Copies voice + render configs from channel defaults at creation time —
 * later changes to channel defaults don't affect this project.
 * Status starts at "draft". Logs the initial transition.
 */
export const createProject = mutation({
  args: {
    channelId:   v.id("channels"),
    title:       v.string(),
    description: v.optional(v.string()),
    script:      v.optional(v.string()),
    // Optional overrides — if omitted, channel defaults are used
    voice:       v.optional(voiceConfigV),
    render:      v.optional(renderConfigV),
  },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new ConvexError("Channel not found.");
    if (channel.archivedAt) {
      throw new ConvexError("Cannot create a project in an archived channel.");
    }

    const now = Date.now();

    const projectId = await ctx.db.insert("projects", {
      channelId:    args.channelId,
      title:        args.title.trim(),
      description:  args.description?.trim(),
      script:       args.script?.trim(),

      // Snapshot channel defaults — independently editable from here on
      voice:  args.voice  ?? channel.defaultVoice,
      render: args.render ?? channel.defaultRender,

      status:          "draft",
      totalImages:     0,
      imagesConfirmed: 0,

      createdAt: now,
      updatedAt: now,
    });

    // Log the initial draft state
    await ctx.runMutation(internal.statuslog.logTransition, {
      projectId,
      toStatus:    "draft",
      triggeredBy: "user",
      note:        "Project created.",
    });

    return projectId;
  },
});

/**
 * updateProject
 * Updates title, description, script, voice, and/or render config.
 * Only allowed in "draft" or "error" status — mid-pipeline edits are rejected.
 */
export const updateProject = mutation({
  args: {
    projectId:   v.id("projects"),
    title:       v.optional(v.string()),
    description: v.optional(v.string()),
    script:      v.optional(v.string()),
    voice:       v.optional(voiceConfigV),
    render:      v.optional(renderConfigV),
  },
  handler: async (ctx, args) => {
    const project = await assertProjectEditable(ctx, args.projectId);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.title       !== undefined) patch.title       = args.title.trim();
    if (args.description !== undefined) patch.description = args.description.trim() || undefined;
    if (args.script      !== undefined) patch.script      = args.script.trim()      || undefined;
    if (args.voice       !== undefined) patch.voice       = args.voice;
    if (args.render      !== undefined) patch.render      = args.render;

    await ctx.db.patch(args.projectId, patch);
    return args.projectId;
  },
});

/**
 * deleteProject
 * Soft delete — sets deletedAt.
 * Blocked if the pipeline is actively running (audio_pending, scene_map_pending,
 * rendering). Allows delete from any idle state including mid-pipeline pauses.
 */
export const deleteProject = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await assertPipelineIdle(ctx, projectId);

    await ctx.db.patch(projectId, {
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return projectId;
  },
});


// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE TRANSITIONS
// All status changes go through transitionStatus() — never patch directly.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * setAudioReady
 * Called after TTS succeeds.
 * Stores audio refs + word timestamps.
 * Transition: audio_pending → audio_ready
 */
export const setAudioReady = mutation({
  args: {
    projectId:         v.id("projects"),
    audioStorageId:    v.id("_storage"),
    audioUrl:          v.string(),
    audioDurationSecs: v.number(),
    timestamps:        v.optional(v.array(v.object({
      word:  v.string(),
      start: v.number(),
      end:   v.number(),
    }))),
  },
  handler: async (ctx, args) => {
    const project = await assertProjectExists(ctx, args.projectId);

    if (project.status !== "audio_pending") {
      throw new ConvexError(
        `setAudioReady expects status "audio_pending", got "${project.status}".`,
      );
    }

    await transitionStatus(ctx, args.projectId, "audio_ready", {
      fromStatus:  "audio_pending",
      triggeredBy: "system",
      note:        `Audio ready. Duration: ${args.audioDurationSecs.toFixed(2)}s.`,
      extraPatch: {
        audioStorageId:    args.audioStorageId,
        audioUrl:          args.audioUrl,
        audioDurationSecs: args.audioDurationSecs,
        timestamps:        args.timestamps,
      },
    });

    return args.projectId;
  },
});

/**
 * setSceneMapReady
 * Called after GPT-4o builds the scene map and scenes rows have been inserted.
 * Sets totalImages and advances:
 *   scene_map_pending → scene_map_ready → pending_images  (two hops, atomic)
 */
export const setSceneMapReady = mutation({
  args: {
    projectId:   v.id("projects"),
    totalImages: v.number(),
  },
  handler: async (ctx, args) => {
    const project = await assertProjectExists(ctx, args.projectId);

    if (project.status !== "scene_map_pending") {
      throw new ConvexError(
        `setSceneMapReady expects status "scene_map_pending", got "${project.status}".`,
      );
    }

    if (args.totalImages < 1) {
      throw new ConvexError("totalImages must be at least 1.");
    }

    // Hop 1: scene_map_pending → scene_map_ready
    await transitionStatus(ctx, args.projectId, "scene_map_ready", {
      fromStatus:  "scene_map_pending",
      triggeredBy: "system",
      note:        `Scene map built. ${args.totalImages} scenes.`,
      extraPatch:  { totalImages: args.totalImages, imagesConfirmed: 0 },
    });

    // Hop 2: scene_map_ready → pending_images  (immediate — no user action needed)
    await transitionStatus(ctx, args.projectId, "pending_images", {
      fromStatus:  "scene_map_ready",
      triggeredBy: "system",
      note:        "Waiting for images.",
    });

    return args.projectId;
  },
});

/**
 * confirmImageReady
 * Called once per scene image as it becomes available (upload or generation).
 * Increments imagesConfirmed.
 * When imagesConfirmed reaches totalImages, auto-advances:
 *   pending_images → audio_ready
 *
 * Idempotent guard: a scene that is already confirmed won't double-count.
 * Caller must pass sceneId so we can check imageReady before incrementing.
 */
export const confirmImageReady = mutation({
  args: {
    projectId: v.id("projects"),
    sceneId:   v.id("scenes"),
  },
  handler: async (ctx, args) => {
    const project = await assertProjectExists(ctx, args.projectId);

    if (project.status !== "pending_images") {
      throw new ConvexError(
        `confirmImageReady expects status "pending_images", got "${project.status}".`,
      );
    }

    // Idempotency: skip if this scene was already confirmed
    const scene = await ctx.db.get(args.sceneId);
    if (!scene) throw new ConvexError("Scene not found.");
    if (scene.imageReady) return args.projectId; // already counted

    // Mark the scene confirmed
    await ctx.db.patch(args.sceneId, {
      imageReady: true,
      updatedAt:  Date.now(),
    });

    const newCount = project.imagesConfirmed + 1;

    if (newCount >= project.totalImages) {
      // All images in — advance to audio_ready (render not yet triggered)
      await transitionStatus(ctx, args.projectId, "audio_ready", {
        fromStatus:  "pending_images",
        triggeredBy: "system",
        note:        `All ${project.totalImages} images confirmed. Ready to render.`,
        extraPatch:  { imagesConfirmed: newCount },
      });
    } else {
      // More images still coming — just update the counter
      await ctx.db.patch(args.projectId, {
        imagesConfirmed: newCount,
        updatedAt:       Date.now(),
      });
    }

    return args.projectId;
  },
});

/**
 * setRendering
 * Triggered by the user pressing the render button.
 * Transition: audio_ready → rendering
 */
export const setRendering = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await assertProjectExists(ctx, projectId);

    if (project.status !== "audio_ready") {
      throw new ConvexError(
        `setRendering expects status "audio_ready", got "${project.status}".`,
      );
    }

    await transitionStatus(ctx, projectId, "rendering", {
      fromStatus:  "audio_ready",
      triggeredBy: "user",
      note:        "Render triggered.",
    });

    return projectId;
  },
});

/**
 * setRenderDone
 * Called by the Python callback (via http.ts → renderJobs → here).
 * Stores the output video refs.
 * Transition: rendering → done
 */
export const setRenderDone = mutation({
  args: {
    projectId:          v.id("projects"),
    outputStorageId:    v.optional(v.id("_storage")),
    outputUrl:          v.string(),
    outputSizeBytes:    v.optional(v.number()),
    outputDurationSecs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const project = await assertProjectExists(ctx, args.projectId);

    if (project.status !== "rendering") {
      throw new ConvexError(
        `setRenderDone expects status "rendering", got "${project.status}".`,
      );
    }

    await transitionStatus(ctx, args.projectId, "done", {
      fromStatus:  "rendering",
      triggeredBy: "renderer",
      note:        "Render complete.",
      extraPatch:  {
        outputStorageId:    args.outputStorageId,
        outputUrl:          args.outputUrl,
        outputSizeBytes:    args.outputSizeBytes,
        outputDurationSecs: args.outputDurationSecs,
      },
    });

    return args.projectId;
  },
});

/**
 * setError
 * Moves any non-deleted status → "error".
 * Always valid — a pipeline can fail from any stage.
 * Stores errorStage + errorMessage for the UI and retry logic.
 */
export const setError = mutation({
  args: {
    projectId:    v.id("projects"),
    errorStage:   v.union(
      v.literal("audio"),
      v.literal("scene_map"),
      v.literal("render"),
    ),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await assertProjectExists(ctx, args.projectId);

    await transitionStatus(ctx, args.projectId, "error", {
      fromStatus:  project.status,
      triggeredBy: "system",
      note:        `Error in stage "${args.errorStage}": ${args.errorMessage}`,
      extraPatch:  {
        errorStage:   args.errorStage,
        errorMessage: args.errorMessage,
      },
    });

    return args.projectId;
  },
});

/**
 * resetToAudioReady
 * Clears the error state and returns the project to "audio_ready"
 * so the user can retry the render.
 * Only valid when errorStage === "render".
 *
 * For errorStage === "scene_map": the user should re-trigger scene map
 * generation from the project page (separate flow, not handled here).
 *
 * For errorStage === "audio": the user should re-trigger TTS
 * (separate flow, not handled here).
 */
export const resetToAudioReady = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await assertProjectExists(ctx, projectId);

    if (project.status !== "error") {
      throw new ConvexError(
        `resetToAudioReady requires status "error", got "${project.status}".`,
      );
    }

    if (project.errorStage !== "render") {
      throw new ConvexError(
        `resetToAudioReady only handles render errors. ` +
        `This project errored at stage "${project.errorStage}". ` +
        `Use the appropriate retry action for that stage.`,
      );
    }

    await transitionStatus(ctx, projectId, "audio_ready", {
      fromStatus:  "error",
      triggeredBy: "user",
      note:        "Render error cleared. Ready to retry.",
      extraPatch:  {
        errorStage:   undefined,
        errorMessage: undefined,
      },
    });

    return projectId;
  },
});


// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL MUTATIONS
// Called from other Convex files (e.g. http.ts) — not from the client.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * internalSetRenderDone
 * Same as setRenderDone but callable from http.ts without exposing it
 * as a public mutation. The HTTP callback route uses this.
 */
export const internalSetRenderDone = internalMutation({
  args: {
    projectId:          v.id("projects"),
    outputStorageId:    v.optional(v.id("_storage")),
    outputUrl:          v.string(),
    outputSizeBytes:    v.optional(v.number()),
    outputDurationSecs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const project = await assertProjectExists(ctx, args.projectId);

    if (project.status !== "rendering") {
      throw new ConvexError(
        `internalSetRenderDone expects status "rendering", got "${project.status}".`,
      );
    }

    await transitionStatus(ctx, args.projectId, "done", {
      fromStatus:  "rendering",
      triggeredBy: "renderer",
      note:        "Render complete (callback).",
      extraPatch:  {
        outputStorageId:    args.outputStorageId,
        outputUrl:          args.outputUrl,
        outputSizeBytes:    args.outputSizeBytes,
        outputDurationSecs: args.outputDurationSecs,
      },
    });

    return args.projectId;
  },
});

/**
 * internalSetError
 * Same as setError but callable from http.ts / scheduled functions.
 */
export const internalSetError = internalMutation({
  args: {
    projectId:    v.id("projects"),
    errorStage:   v.union(
      v.literal("audio"),
      v.literal("scene_map"),
      v.literal("render"),
    ),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await assertProjectExists(ctx, args.projectId);

    await transitionStatus(ctx, args.projectId, "error", {
      fromStatus:  project.status,
      triggeredBy: "system",
      note:        `Error in stage "${args.errorStage}": ${args.errorMessage}`,
      extraPatch:  {
        errorStage:   args.errorStage,
        errorMessage: args.errorMessage,
      },
    });

    return args.projectId;
  },
});


// ADD THIS to convex/projects.ts — at the bottom, alongside internalSetRenderDone
//
// setRenderingInternal
// Same as the public setRendering but callable from renderJobs.createRenderJob
// via ctx.runMutation(internal.projects.setRenderingInternal, { projectId }).
// The public setRendering stays for direct UI button calls.

export const setRenderingInternal = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await assertProjectExists(ctx, projectId);

    if (project.status !== "audio_ready") {
      throw new ConvexError(
        `setRenderingInternal expects status "audio_ready", got "${project.status}".`,
      );
    }

    await transitionStatus(ctx, projectId, "rendering", {
      fromStatus:  "audio_ready",
      triggeredBy: "system",
      note:        "Render job created — pipeline started.",
    });

    return projectId;
  },
});