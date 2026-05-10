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
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const EDITABLE_STATUSES = new Set([
  "draft",
  "error",
  // Also allow scene edits while images are still pending —
  // user may want to swap/delete a scene mid-upload before render.
  "pending_images",
  "audio_ready",
  "scene_map_ready",
] as const);


// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// Plain TypeScript — not exported as Convex functions.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildImageFilename
 * Pure function. Derives the canonical on-disk filename from uploadOrder.
 * uploadOrder is 0-based → filename is 1-based and zero-padded to 3 digits.
 *   0  → "scene_001.png"
 *   11 → "scene_012.png"
 */
function buildImageFilename(uploadOrder: number): string {
  return `scene_${String(uploadOrder + 1).padStart(3, "0")}.png`;
}

/**
 * getActiveGeneration
 * Returns the highest generation number among all scenes for a project.
 * Returns 0 if no scenes exist yet — first insert uses generation 1.
 */
async function getActiveGeneration(
  ctx:       MutationCtx,
  projectId: Id<"projects">,
): Promise<number> {
  // Collect all scenes and find max generation.
  // Convex doesn't support aggregate MAX yet, so we pull all and reduce.
  // In practice scene counts are small (< 200) so this is fine.
  const scenes = await ctx.db
    .query("scenes")
    .withIndex("by_project", q => q.eq("projectId", projectId))
    .collect();

  if (scenes.length === 0) return 0;
  return Math.max(...scenes.map(s => s.generation));
}

/**
 * assertProjectEditable
 * Scenes share a looser editable rule than projects:
 * allowed in draft, error, pending_images, audio_ready, scene_map_ready.
 * Blocked during active pipeline stages: audio_pending, scene_map_pending, rendering.
 */
async function assertProjectSceneEditable(
  ctx:       MutationCtx,
  projectId: Id<"projects">,
) {
  const project = await ctx.db.get(projectId);
  if (!project)          throw new ConvexError("Project not found.");
  if (project.deletedAt) throw new ConvexError("Project has been deleted.");

  if (!EDITABLE_STATUSES.has(project.status as any)) {
    throw new ConvexError(
      `Scenes cannot be modified while project is in status "${project.status}".`,
    );
  }
  return project;
}

/**
 * recalcImageCounts
 * After any scene insert/delete, recalculate totalImages + imagesConfirmed
 * directly from the scenes table for the active generation.
 * Single source of truth — never manually increment/decrement in callers.
 */
async function recalcImageCounts(
  ctx:        MutationCtx,
  projectId:  Id<"projects">,
  generation: number,
): Promise<void> {
  const scenes = await ctx.db
    .query("scenes")
    .withIndex("by_project_generation", q =>
      q.eq("projectId", projectId).eq("generation", generation),
    )
    .collect();

  const total     = scenes.length;
  const confirmed = scenes.filter(s => s.imageReady).length;
  const now       = Date.now();

  // Fetch project to check current status
  const project = await ctx.db.get(projectId);
  if (!project || project.deletedAt) return;

  // If all images are now confirmed and we're waiting for them, advance to audio_ready
  if (total > 0 && confirmed >= total && project.status === "pending_images") {
    await ctx.db.patch(projectId, {
      totalImages:     total,
      imagesConfirmed: confirmed,
      status:          "audio_ready",
      updatedAt:       now,
    });
    await ctx.runMutation(internal.statuslog.logTransition, {
      projectId,
      fromStatus:  "pending_images",
      toStatus:    "audio_ready",
      triggeredBy: "system",
      note:        `All ${total} images confirmed. Advancing to audio_ready.`,
    });
  } else {
    // Just update the counters
    await ctx.db.patch(projectId, {
      totalImages:     total,
      imagesConfirmed: confirmed,
      updatedAt:       now,
    });
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// READS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * listScenes
 * All active-generation scenes for a project, sorted by sceneIndex asc.
 * This is the query the image grid subscribes to.
 * Only returns the current (max) generation — old generations are invisible to UI.
 */
export const listScenes = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const allScenes = await ctx.db
      .query("scenes")
      .withIndex("by_project", q => q.eq("projectId", projectId))
      .collect();

    if (allScenes.length === 0) return [];

    const maxGen     = Math.max(...allScenes.map(s => s.generation));
    const activeScenes = allScenes
      .filter(s => s.generation === maxGen)
      .sort((a, b) => a.sceneIndex - b.sceneIndex);

    return activeScenes;
  },
});

/**
 * getScene
 * Single scene by _id. Returns null if not found.
 */
export const getScene = query({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, { sceneId }) => {
    return await ctx.db.get(sceneId);
  },
});

/**
 * getSceneProgress
 * Lightweight upload progress query.
 * Returns { total, confirmed, percent } for the progress bar.
 * Reads directly from the project doc — no scene scan needed.
 */
export const getSceneProgress = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project || project.deletedAt) return null;

    const total     = project.totalImages;
    const confirmed = project.imagesConfirmed;
    const percent   = total > 0 ? Math.round((confirmed / total) * 100) : 0;

    return { total, confirmed, percent };
  },
});


// ─────────────────────────────────────────────────────────────────────────────
// WRITES — UPLOAD FLOW
// ─────────────────────────────────────────────────────────────────────────────

/**
 * registerUploadedScenes
 * Bulk insert called once after the Next.js app uploads a folder of images.
 *
 * APPEND behaviour:
 *   - Finds the current max uploadOrder across ALL existing scenes for this
 *     project (any generation) so new filenames never collide with old ones.
 *   - Continues the sceneIndex from the current active-generation max.
 *   - Uses the same generation as existing active scenes (not a new generation —
 *     uploads are additive, not a regeneration event).
 *
 * Each item in `scenes`:
 *   { storageId, imageUrl, originalFilename }
 *   originalFilename is stored for reference only — the canonical filename
 *   is always derived from uploadOrder.
 *
 * Also sets projects.localImageFolder if provided.
 */
export const registerUploadedScenes = mutation({
  args: {
    projectId:        v.id("projects"),
    localImageFolder: v.optional(v.string()),
    scenes: v.array(v.object({
      storageId:        v.id("_storage"),
      imageUrl:         v.string(),
      originalFilename: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    if (args.scenes.length === 0) {
      throw new ConvexError("scenes array must not be empty.");
    }

    await assertProjectSceneEditable(ctx, args.projectId);

    const now = Date.now();

    // ── Find current maximums ────────────────────────────────────────────────
    const existingScenes = await ctx.db
      .query("scenes")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .collect();

    // uploadOrder is global across all generations — filenames must never collide
    const maxUploadOrder = existingScenes.length > 0
      ? Math.max(...existingScenes.map(s => s.uploadOrder))
      : -1;

    // sceneIndex continues from the current active generation only
    const activeGeneration = existingScenes.length > 0
      ? Math.max(...existingScenes.map(s => s.generation))
      : 1;

    const activeScenes = existingScenes.filter(s => s.generation === activeGeneration);
    const maxSceneIndex = activeScenes.length > 0
      ? Math.max(...activeScenes.map(s => s.sceneIndex))
      : -1;

    // ── Insert each scene ────────────────────────────────────────────────────
    const insertedIds: Id<"scenes">[] = [];

    for (let i = 0; i < args.scenes.length; i++) {
      const item        = args.scenes[i];
      const uploadOrder = maxUploadOrder + 1 + i;
      const sceneIndex  = maxSceneIndex  + 1 + i;

      const sceneId = await ctx.db.insert("scenes", {
        projectId:     args.projectId,
        sceneIndex,
        uploadOrder,
        imageFilename: buildImageFilename(uploadOrder),
        imageStorageId:item.storageId,
        imageUrl:      item.imageUrl,
        imageReady:    true,
        imageSource:   "upload",
        motion:        "static",
        generation:    activeGeneration,
        createdAt:     now,
        updatedAt:     now,
      });

      insertedIds.push(sceneId);
    }

    // ── Update project ───────────────────────────────────────────────────────
    const projectPatch: Record<string, unknown> = { updatedAt: now };
    if (args.localImageFolder) {
      projectPatch.localImageFolder = args.localImageFolder;
    }
    await ctx.db.patch(args.projectId, projectPatch);

    // Recalc counts from source of truth
    await recalcImageCounts(ctx, args.projectId, activeGeneration);

    return insertedIds;
  },
});

/**
 * replaceSceneImage
 * Swaps the image for one scene.
 * Does NOT change sceneIndex, uploadOrder, or imageFilename —
 * only the storage ref + url change.
 * Marks imageReady: true (in case it was previously false).
 * Recalculates project image counts after.
 */
export const replaceSceneImage = mutation({
  args: {
    sceneId:    v.id("scenes"),
    storageId:  v.id("_storage"),
    imageUrl:   v.string(),
  },
  handler: async (ctx, args) => {
    const scene = await ctx.db.get(args.sceneId);
    if (!scene) throw new ConvexError("Scene not found.");

    await assertProjectSceneEditable(ctx, scene.projectId);

    const wasReady = scene.imageReady;

    await ctx.db.patch(args.sceneId, {
      imageStorageId: args.storageId,
      imageUrl:       args.imageUrl,
      imageReady:     true,
      imageSource:    "upload",
      updatedAt:      Date.now(),
    });

    // Only recalc if readiness changed — avoids a write on every swap
    if (!wasReady) {
      await recalcImageCounts(ctx, scene.projectId, scene.generation);
    }

    return args.sceneId;
  },
});

/**
 * deleteScene
 * Hard-deletes a single scene row.
 * Only allowed in editable project statuses (same rule as scene edits).
 * Recalculates project totalImages + imagesConfirmed after removal.
 *
 * Note: imageFilename on disk is NOT deleted here — that's the Next.js
 * app's responsibility via a server action. Convex only owns the DB row.
 */
export const deleteScene = mutation({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, { sceneId }) => {
    const scene = await ctx.db.get(sceneId);
    if (!scene) throw new ConvexError("Scene not found.");

    await assertProjectSceneEditable(ctx, scene.projectId);

    const { projectId, generation } = scene;

    await ctx.db.delete(sceneId);

    // Recalc counts — totalImages just dropped by 1
    await recalcImageCounts(ctx, projectId, generation);

    return sceneId;
  },
});


// ─────────────────────────────────────────────────────────────────────────────
// WRITES — RESEQUENCING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * resequenceScenes
 * Called after drag-and-drop. Accepts the new ordered array of sceneIds.
 * Updates ONLY sceneIndex — imageFilename and uploadOrder are never touched.
 *
 * Validations:
 *   - All sceneIds must exist.
 *   - All must belong to the same projectId.
 *   - All must belong to the same generation (active generation).
 *   - The array must contain ALL scenes for that generation —
 *     partial resequence is rejected to prevent index gaps.
 */
export const resequenceScenes = mutation({
  args: {
    projectId: v.id("projects"),
    sceneIds:  v.array(v.id("scenes")),
  },
  handler: async (ctx, args) => {
    if (args.sceneIds.length === 0) {
      throw new ConvexError("sceneIds must not be empty.");
    }

    await assertProjectSceneEditable(ctx, args.projectId);

    // Fetch all scenes in one pass
    const scenes = await Promise.all(
      args.sceneIds.map(id => ctx.db.get(id)),
    );

    // Validate: all exist
    const missing = scenes.findIndex(s => s === null);
    if (missing !== -1) {
      throw new ConvexError(`Scene at index ${missing} not found.`);
    }

    const validScenes = scenes as NonNullable<typeof scenes[number]>[];

    // Validate: all belong to this project
    const wrongProject = validScenes.find(s => s.projectId !== args.projectId);
    if (wrongProject) {
      throw new ConvexError(
        `Scene ${wrongProject._id} does not belong to project ${args.projectId}.`,
      );
    }

    // Validate: all same generation
    const generations = new Set(validScenes.map(s => s.generation));
    if (generations.size > 1) {
      throw new ConvexError("Cannot resequence scenes across different generations.");
    }

    const generation = validScenes[0].generation;

    // Validate: covers ALL scenes in this generation (no gaps)
    const allGenScenes = await ctx.db
      .query("scenes")
      .withIndex("by_project_generation", q =>
        q.eq("projectId", args.projectId).eq("generation", generation),
      )
      .collect();

    if (allGenScenes.length !== args.sceneIds.length) {
      throw new ConvexError(
        `Resequence must include all ${allGenScenes.length} scenes. ` +
        `Got ${args.sceneIds.length}.`,
      );
    }

    // ── Apply new sceneIndex values ──────────────────────────────────────────
    const now = Date.now();
    for (let newIndex = 0; newIndex < args.sceneIds.length; newIndex++) {
      await ctx.db.patch(args.sceneIds[newIndex], {
        sceneIndex: newIndex,
        updatedAt:  now,
      });
    }

    return args.projectId;
  },
});


// ─────────────────────────────────────────────────────────────────────────────
// WRITES — AI SCENE MAP FLOW
// internalMutations — not callable from the browser.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * bulkInsertScenes
 * Called by the GPT-4o action after the scene map is built.
 * Increments generation vs the current max — this IS a new generation event,
 * unlike uploads which append to the existing generation.
 *
 * Does NOT set imageReady — images arrive asynchronously via markSceneImageReady.
 * Calls projects.setSceneMapReady after all rows are inserted.
 *
 * Each item in `scenes`:
 * {
 *   sceneIndex, startTime, endTime, duration,
 *   subtitleText, imagePrompt, motion
 * }
 */
export const bulkInsertScenes = internalMutation({
  args: {
    projectId: v.id("projects"),
    scenes: v.array(v.object({
      sceneIndex:   v.number(),
      startTime:    v.number(),
      endTime:      v.number(),
      duration:     v.number(),
      subtitleText: v.string(),
      imagePrompt:  v.optional(v.string()),
      motion:       v.union(
        v.literal("zoom_in"),
        v.literal("zoom_out"),
        v.literal("pan_left"),
        v.literal("pan_right"),
        v.literal("pan_up"),
        v.literal("pan_down"),
        v.literal("static"),
      ),
    })),
  },
  handler: async (ctx, args) => {
    if (args.scenes.length === 0) {
      throw new ConvexError("scenes array must not be empty.");
    }

    const now = Date.now();

    // New generation = current max + 1
    const currentGen = await getActiveGeneration(ctx, args.projectId);
    const generation = currentGen + 1;

    for (const item of args.scenes) {
      await ctx.db.insert("scenes", {
        projectId:     args.projectId,
        sceneIndex:    item.sceneIndex,
        uploadOrder:   item.sceneIndex,   // for AI scenes, uploadOrder = sceneIndex at creation
        imageFilename: buildImageFilename(item.sceneIndex),
        startTime:     item.startTime,
        endTime:       item.endTime,
        duration:      item.duration,
        subtitleText:  item.subtitleText,
        imagePrompt:   item.imagePrompt,
        motion:        item.motion,
        imageReady:    false,
        imageSource:   "openai",
        generation,
        createdAt:     now,
        updatedAt:     now,
      });
    }

    // Advance project status: scene_map_pending → scene_map_ready → pending_images
    await ctx.runMutation(internal.projects.setSceneMapReady, {
      projectId:   args.projectId,
      totalImages: args.scenes.length,
    });

    return generation;
  },
});

/**
 * markSceneImageReady
 * Called after an AI-generated image finishes generating and is stored.
 * Sets imageStorageId + imageUrl + imageReady: true on the scene.
 * Then calls projects.confirmImageReady to increment the counter
 * and potentially advance the project status.
 */
export const markSceneImageReady = internalMutation({
  args: {
    sceneId:   v.id("scenes"),
    storageId: v.id("_storage"),
    imageUrl:  v.string(),
  },
  handler: async (ctx, args) => {
    const scene = await ctx.db.get(args.sceneId);
    if (!scene) throw new ConvexError("Scene not found.");
    if (scene.imageReady) return args.sceneId; // idempotent

    await ctx.db.patch(args.sceneId, {
      imageStorageId: args.storageId,
      imageUrl:       args.imageUrl,
      imageReady:     true,
      updatedAt:      Date.now(),
    });

    // Delegate counter + status advancement to projects
    await ctx.runMutation(internal.projects.confirmImageReady, {
      projectId: scene.projectId,
      sceneId:   args.sceneId,
    });

    return args.sceneId;
  },
});