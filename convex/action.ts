import { v }       from "convex/values";
import { action }   from "./_generated/server";
import { internal } from "./_generated/api";

// ─────────────────────────────────────────────────────────────────────────────
// convex/actions.ts
//
// Convex Actions bridge Next.js server actions and Convex internalMutations.
//
// Rule: internalMutations cannot be called from the browser or Next.js
// server actions directly. A Convex Action CAN call them via ctx.runMutation.
//
// All heavy AI work (TTS, GPT-4o) happens in Next.js server actions.
// These Convex actions only handle the DB writes after AI work completes.
// ─────────────────────────────────────────────────────────────────────────────

const motionTypeV = v.union(
  v.literal("zoom_in"),
  v.literal("zoom_out"),
  v.literal("pan_left"),
  v.literal("pan_right"),
  v.literal("pan_up"),
  v.literal("pan_down"),
  v.literal("static"),
);

const wordTimestampV = v.object({
  word:  v.string(),
  start: v.number(),
  end:   v.number(),
});

const sceneInputV = v.object({
  sceneIndex:   v.number(),
  startTime:    v.number(),
  endTime:      v.number(),
  duration:     v.number(),
  subtitleText: v.string(),
  imagePrompt:  v.optional(v.string()),
  motion:       motionTypeV,
});

// ─────────────────────────────────────────────────────────────────────────────
// saveAudioResult
//
// Called by the Next.js voiceover server action after TTS succeeds.
// Writes audio metadata + timestamps to Convex.
// Advances project: audio_pending → audio_ready.
//
// audioUrl: local disk path e.g. "/Users/you/Documents/VidFlow/{id}/audio.mp3"
// timestamps: word-level array built from Google TTS timepoints
// ─────────────────────────────────────────────────────────────────────────────

export const saveAudioResult = action({
  args: {
    projectId:         v.id("projects"),
    audioUrl:          v.string(),
    audioDurationSecs: v.number(),
    timestamps:        v.optional(v.array(wordTimestampV)),
  },
  handler: async (ctx, args) => {
    // setAudioReady is a PUBLIC mutation — actions can call public mutations
    // via ctx.runMutation with the api reference, not internal.
    // But since we want to keep the call internal-only, we use a dedicated
    // internal version. For now setAudioReady is public so we call it directly.
    await ctx.runMutation(internal.projects.setAudioReadyInternal, {
      projectId:         args.projectId,
      audioUrl:          args.audioUrl,
      audioDurationSecs: args.audioDurationSecs,
      timestamps:        args.timestamps,
    });

    return { success: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// insertSceneMap
//
// Called by the Next.js scene map server action after GPT-4o returns scenes.
// 1. Moves project: audio_ready → scene_map_pending (immediate UI feedback)
// 2. Bulk inserts scene rows (increments generation)
// 3. Moves project: scene_map_pending → scene_map_ready → pending_images
// ─────────────────────────────────────────────────────────────────────────────

export const insertSceneMap = action({
  args: {
    projectId: v.id("projects"),
    scenes:    v.array(sceneInputV),
  },
  handler: async (ctx, args): Promise<{ generation: number }> => {
    if (args.scenes.length === 0) {
      throw new Error("scenes array must not be empty.");
    }

    // Step 1: immediate status feedback
    await ctx.runMutation(internal.projects.setSceneMapPending, {
      projectId: args.projectId,
    });

    // Step 2+3: insert scenes + advance status chain
    const generation: number = await ctx.runMutation(
      internal.scenes.bulkInsertScenes,
      {
        projectId: args.projectId,
        scenes:    args.scenes,
      },
    );

    return { generation };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// saveAudioError
// saveSceneMapError
//
// Called when TTS or GPT-4o fails. Moves project → error with correct stage.
// ─────────────────────────────────────────────────────────────────────────────

export const saveAudioError = action({
  args: {
    projectId:    v.id("projects"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.projects.internalSetError, {
      projectId:    args.projectId,
      errorStage:   "audio",
      errorMessage: args.errorMessage,
    });
    return { success: false };
  },
});

export const saveSceneMapError = action({
  args: {
    projectId:    v.id("projects"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.projects.internalSetError, {
      projectId:    args.projectId,
      errorStage:   "scene_map",
      errorMessage: args.errorMessage,
    });
    return { success: false };
  },
});