import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ─────────────────────────────────────────────────────────────────────────────
// SHARED VALIDATORS
// ─────────────────────────────────────────────────────────────────────────────

const voiceConfig = v.object({
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

const renderConfig = v.object({
  resolution: v.union(v.literal("720p"), v.literal("1080p"), v.literal("4K")),
  fps:        v.union(v.literal(24), v.literal(30), v.literal(60)),
  format:     v.union(v.literal("mp4"), v.literal("webm")),
});

const projectStatus = v.union(
  v.literal("draft"),
  v.literal("audio_pending"),
  v.literal("audio_ready"),
  v.literal("scene_map_pending"),
  v.literal("scene_map_ready"),
  v.literal("pending_images"),
  v.literal("rendering"),
  v.literal("done"),
  v.literal("error"),
);

const errorStage = v.union(
  v.literal("audio"),
  v.literal("scene_map"),
  v.literal("render"),
);

const motionType = v.union(
  v.literal("zoom_in"),
  v.literal("zoom_out"),
  v.literal("pan_left"),
  v.literal("pan_right"),
  v.literal("pan_up"),
  v.literal("pan_down"),
  v.literal("static"),
);

const triggeredBy = v.union(
  v.literal("user"),
  v.literal("system"),
  v.literal("renderer"),
);

const renderJobStatus = v.union(
  v.literal("queued"),
  v.literal("rendering"),
  v.literal("done"),
  v.literal("error"),
  v.literal("cancelled"),
);

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

export default defineSchema({

  // ── 1. CHANNELS ─────────────────────────────────────────────────────────────
  // Top-level workspace. Route: /channels/[channelId]/projects/[projectId]
  // Each channel has its own default voice + render config.
  // Projects inherit these at creation — editing defaults never breaks
  // a project that's already mid-pipeline.
  channels: defineTable({
    name:         v.string(),
    slug:         v.string(),              // url-safe unique: "tech-reviews"
    description:  v.optional(v.string()),
    color:        v.optional(v.string()),  // hex accent for sidebar

    defaultVoice:  voiceConfig,
    defaultRender: renderConfig,

    archivedAt:   v.optional(v.number()),
    createdAt:    v.number(),
    updatedAt:    v.number(),
  })
    .index("by_slug",    ["slug"])
    .index("by_created", ["createdAt"]),


  // ── 2. PROJECTS ─────────────────────────────────────────────────────────────
  // One project = one video. Belongs to a channel.
  // voice + render config are copied from the channel at creation,
  // stored independently, and fully overridable per project.
  projects: defineTable({
    channelId:    v.id("channels"),

    title:        v.string(),
    script:       v.optional(v.string()),
    description:  v.optional(v.string()),

    // Audio — stored in Convex file storage, no local paths
    audioStorageId:    v.optional(v.id("_storage")),
    audioUrl:          v.optional(v.string()),
    audioDurationSecs: v.optional(v.number()),

    // Word-level timestamps from Chirp TTS.
    // Stored as a typed array — never a raw JSON string.
    // For very long scripts (500+ words) move this to a _storage JSON file
    // and store timestampsStorageId instead.
    timestamps: v.optional(v.array(v.object({
      word:  v.string(),
      start: v.number(),  // seconds
      end:   v.number(),  // seconds
    }))),

    // Output video
    outputStorageId:    v.optional(v.id("_storage")),
    outputUrl:          v.optional(v.string()),
    outputSizeBytes:    v.optional(v.number()),
    outputDurationSecs: v.optional(v.number()),

    // Configs — copied from channel defaults at creation, independently editable
    voice:  voiceConfig,
    render: renderConfig,

    // Pipeline state machine
    status:       projectStatus,
    errorStage:   v.optional(errorStage),
    errorMessage: v.optional(v.string()),

    // Image progress — tracked reactively via Convex
    // totalImages is set when the scene map is built (or when images are uploaded)
    totalImages:     v.number(),
    imagesConfirmed: v.number(),

    // Local filesystem folder where Python renderer reads/writes images.
    // Format: absolute path on the local machine, e.g. "/projects/my-video/images"
    // Created automatically by the Next.js app when images are uploaded.
    // Python backend uses this to locate scene_001.png, scene_002.png …
    localImageFolder: v.optional(v.string()),

    deletedAt:    v.optional(v.number()),
    createdAt:    v.number(),
    updatedAt:    v.number(),
  })
    .index("by_channel",         ["channelId"])
    .index("by_channel_status",  ["channelId", "status"])
    .index("by_channel_created", ["channelId", "createdAt"])
    .index("by_channel_active",  ["channelId", "deletedAt"]),


  // ── 3. SCENES ───────────────────────────────────────────────────────────────
  // One row per visual scene.
  //
  // SEQUENCING MODEL
  // ─────────────────
  // • `sceneIndex`   — the display/render order (0-based). This is what the
  //                    user reorders via drag-and-drop. Mutable.
  // • `uploadOrder`  — the original order the file arrived in the upload batch
  //                    (0-based). Immutable after creation. Used to derive the
  //                    canonical filename: scene_001, scene_002 …
  //
  // When the user reorders scenes, only `sceneIndex` values are updated —
  // filenames on disk never change, preventing broken file references.
  //
  // GENERATION VERSIONING
  // ──────────────────────
  // `generation` increments each time the scene map is regenerated by GPT-4o.
  // Only scenes with the highest generation for a project are "active".
  // Old generations are kept for undo/comparison without a separate table.
  //
  // UPLOAD SOURCE
  // ──────────────
  // `imageSource` tracks where the image came from:
  //   "upload"  — user dropped a file via the Next.js UI
  //   "openai"  — generated by the AI pipeline
  scenes: defineTable({
    projectId:    v.id("projects"),

    // Display/render order — updated on drag-and-drop resequencing
    sceneIndex:   v.number(),

    // Arrival order within its upload batch — immutable, drives filename
    // For AI-generated scenes this equals sceneIndex at creation time.
    uploadOrder:  v.number(),

    // Scene map timing (set by GPT-4o; null for upload-only scenes)
    startTime:    v.optional(v.number()),
    endTime:      v.optional(v.number()),
    duration:     v.optional(v.number()),

    subtitleText: v.optional(v.string()),   // optional for pure upload workflow
    imagePrompt:  v.optional(v.string()),
    motion:       motionType,

    // Convex storage ref + public URL (set after upload or generation)
    imageStorageId: v.optional(v.id("_storage")),
    imageUrl:       v.optional(v.string()),

    // Canonical local filename derived from uploadOrder: "scene_001.png"
    // Written to `projects.localImageFolder` by the Next.js app on upload.
    // Never changes after creation — sceneIndex changing does NOT rename files.
    imageFilename:  v.string(),

    imageReady:   v.boolean(),

    imageSource: v.optional(v.union(
      v.literal("openai"),
      v.literal("upload"),
    )),

    // Scene map generation counter — only the max generation is "active"
    generation:   v.number(),

    createdAt:    v.number(),
    updatedAt:    v.number(),
  })
    .index("by_project",            ["projectId"])
    .index("by_project_index",      ["projectId", "sceneIndex"])
    .index("by_project_generation", ["projectId", "generation"])
    .index("by_project_ready",      ["projectId", "imageReady"]),


  // ── 4. RENDER JOBS ──────────────────────────────────────────────────────────
  // One record per render attempt. Latest by createdAt is canonical.
  //
  // PYTHON CALLBACK PATTERN
  // ────────────────────────
  // 1. Convex mutation creates a renderJob (status: "queued")
  // 2. Convex HTTP Action POSTs the job to the local Python backend
  // 3. Python renders, calls back the Convex HTTP endpoint with progress
  // 4. Convex mutation updates progress → eventually status: "done"
  //
  // `externalJobId`  — Python-side job ID, used for polling fallback
  // `callbackSecret` — HMAC token so Python can authenticate its callbacks
  //                    (generate with crypto.randomUUID() at job creation)
  renderJobs: defineTable({
    projectId:       v.id("projects"),

    // Snapshot of the render config used for THIS job.
    // Survives later edits to projects.render — critical for retry comparison.
    renderConfig:    renderConfig,

    status:          renderJobStatus,
    progress:        v.number(),           // 0–100

    // Python-side identifiers for callback auth + polling fallback
    externalJobId:   v.optional(v.string()),
    callbackSecret:  v.optional(v.string()),

    outputStorageId: v.optional(v.id("_storage")),
    outputUrl:       v.optional(v.string()),
    fileSizeBytes:   v.optional(v.number()),
    durationSecs:    v.optional(v.number()),

    errorMessage:    v.optional(v.string()),
    errorStage:      v.optional(errorStage),

    startedAt:       v.optional(v.number()),
    finishedAt:      v.optional(v.number()),
    renderTimeSecs:  v.optional(v.number()),

    createdAt:       v.number(),
    updatedAt:       v.number(),
  })
    .index("by_project",         ["projectId"])
    .index("by_project_status",  ["projectId", "status"])
    .index("by_project_created", ["projectId", "createdAt"]),


  // ── 5. STATUS LOG ───────────────────────────────────────────────────────────
  // Append-only log of every pipeline state transition.
  // Written by Convex mutations only — never by the client directly.
  statusLog: defineTable({
    projectId:   v.id("projects"),
    fromStatus:  v.optional(v.string()),
    toStatus:    v.string(),
    triggeredBy: triggeredBy,
    note:        v.optional(v.string()),
    durationMs:  v.optional(v.number()),
    metadata:    v.optional(v.string()),   // JSON blob for arbitrary extra context
    createdAt:   v.number(),
  })
    .index("by_project",         ["projectId"])
    .index("by_project_created", ["projectId", "createdAt"]),


  // ── 6. CHANNEL SETTINGS ─────────────────────────────────────────────────────
  // Per-channel runtime overrides, e.g. "python_backend_url".
  //
  // NOTE: For a single local instance, prefer Convex environment variables
  // (PYTHON_BACKEND_URL etc.) over this table. Use channelSettings only when
  // you genuinely need per-channel overrides (e.g. different render machines
  // per channel). API keys must NEVER be stored here — use env vars only.
  channelSettings: defineTable({
    channelId: v.id("channels"),
    key:       v.string(),
    value:     v.string(),
    updatedAt: v.number(),
  })
    .index("by_channel",         ["channelId"])
    .index("by_channel_and_key", ["channelId", "key"]),

});


// ─────────────────────────────────────────────────────────────────────────────
// TYPE EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export type ProjectStatus =
  | "draft" | "audio_pending" | "audio_ready"
  | "scene_map_pending" | "scene_map_ready"
  | "pending_images" | "rendering" | "done" | "error";

export type ErrorStage      = "audio" | "scene_map" | "render";
export type MotionType      = "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "pan_up" | "pan_down" | "static";
export type TriggeredBy     = "user" | "system" | "renderer";
export type RenderJobStatus = "queued" | "rendering" | "done" | "error" | "cancelled";

export type WordTimestamp = {
  word:  string;
  start: number;
  end:   number;
};

export type VoiceConfig = {
  voiceName:    string;
  voiceModel:   string;
  languageCode: string;
  speakingRate: number;
  pitch:        number;
  volumeGainDb: number;
  encoding:     "MP3" | "LINEAR16" | "OGG_OPUS";
};

export type RenderConfig = {
  resolution: "720p" | "1080p" | "4K";
  fps:        24 | 30 | 60;
  format:     "mp4" | "webm";
};

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  voiceName:    "Charon",
  voiceModel:   "en-US-Chirp3-HD-Charon",
  languageCode: "en-US",
  speakingRate: 1.0,
  pitch:        0.0,
  volumeGainDb: 0.0,
  encoding:     "MP3",
};

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  resolution: "1080p",
  fps:        30,
  format:     "mp4",
};


// ─────────────────────────────────────────────────────────────────────────────
// MUTATION PATTERNS (reference — not runnable code)
// ─────────────────────────────────────────────────────────────────────────────
//
// ── Uploading a batch of images ──────────────────────────────────────────────
//
//   For each file in the dropped folder (sorted by filename ascending):
//
//   await ctx.db.insert("scenes", {
//     projectId,
//     sceneIndex:  i,          // display order = arrival order initially
//     uploadOrder: i,          // immutable — drives filename forever
//     imageFilename: `scene_${String(i + 1).padStart(3, "0")}.png`,
//     imageStorageId: <storageId from ctx.storage.store()>,
//     imageUrl:    <await ctx.storage.getUrl(storageId)>,
//     imageReady:  true,
//     imageSource: "upload",
//     motion:      "static",
//     generation:  currentGeneration,
//     createdAt:   Date.now(),
//     updatedAt:   Date.now(),
//   });
//
//   After all inserts, update projects.localImageFolder and
//   projects.imagesConfirmed += batch.length.
//
//
// ── Resequencing scenes (drag-and-drop) ─────────────────────────────────────
//
//   The UI sends the new ordered array of scene IDs.
//   Update ONLY sceneIndex — never touch imageFilename or uploadOrder:
//
//   for (const [newIndex, sceneId] of reorderedIds.entries()) {
//     await ctx.db.patch(sceneId, {
//       sceneIndex: newIndex,
//       updatedAt:  Date.now(),
//     });
//   }
//
//   Filenames on disk are untouched. Python renders in sceneIndex order,
//   reading files by imageFilename (which maps to uploadOrder, not sceneIndex).
//
//
// ── Querying active scenes for a project ────────────────────────────────────
//
//   const allScenes = await ctx.db
//     .query("scenes")
//     .withIndex("by_project", q => q.eq("projectId", projectId))
//     .collect();
//
//   const maxGen = Math.max(...allScenes.map(s => s.generation));
//
//   const activeScenes = allScenes
//     .filter(s => s.generation === maxGen)
//     .sort((a, b) => a.sceneIndex - b.sceneIndex);