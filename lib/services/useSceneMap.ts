"use client";

/**
 * lib/services/useSceneMap.ts
 *
 * React hook that orchestrates the full scene map lifecycle.
 *
 * Two paths:
 *
 * PATH A — AI generation (generate / regenerate):
 *   1. Calls Next.js server action (runSceneMapAction)
 *      → server action calls GPT-4o (generateSceneMap)
 *      → server action calls Convex action (insertSceneMap)
 *      → Convex bulkInsertScenes (generation++, scene rows inserted)
 *      → Convex advances project: scene_map_pending → pending_images
 *
 * PATH B — Custom image upload (uploadCustom):
 *   1. Upload each file to Convex storage (ctx.storage.generateUploadUrl)
 *   2. Call scenes.registerUploadedScenes mutation
 *      → inserts scene rows, updates project counts
 *   Note: custom upload does NOT call GPT-4o or change project status
 *         beyond what registerUploadedScenes handles internally.
 *
 * Supports:
 *   generate()      — first AI generation
 *   regenerate()    — re-run GPT-4o (increments generation in Convex)
 *   uploadCustom()  — skip AI, upload images directly
 */

import { useCallback, useState }      from "react";
import { useMutation }                 from "convex/react";
import { api }                         from "@/convex/_generated/api";
import type { Id }                     from "@/convex/_generated/dataModel";
import type { WordTimestamp }          from "./voiceover";
import { runSceneMapAction } from "../actions/scene-map-actions";
import { useChannelSetting } from "@/providers/ChannelContext";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type SceneMapPhase =
  | "idle"
  | "generating"      // GPT-4o in flight
  | "saving"          // writing scenes to Convex
  | "uploading"       // custom image upload in flight
  | "done"
  | "error";

export interface SceneMapState {
  phase:      SceneMapPhase;
  error:      string | null;
  sceneCount: number | null;
  generation: number | null;
  uploadProgress: { current: number; total: number } | null;
}

const INITIAL: SceneMapState = {
  phase:          "idle",
  error:          null,
  sceneCount:     null,
  generation:     null,
  uploadProgress: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useSceneMap
 *
 * @param projectId  Convex project ID
 * @param channelId  Convex channel ID — used to read channelSettings
 *
 * @example
 * const { state, generate, regenerate, uploadCustom, isRunning } =
 *   useSceneMap(projectId, channelId);
 *
 * // AI generation
 * await generate(title, script, timestamps);
 *
 * // Custom upload
 * await uploadCustom(files);
 */
export function useSceneMap(
  projectId: Id<"projects">,
  channelId: Id<"channels">,
) {
  const [state, setState] = useState<SceneMapState>(INITIAL);

  // Per-channel OpenAI key from channelSettings
  const openAiApiKey   = useChannelSetting("openai_api_key");
  const baseProjectDir = useChannelSetting("base_project_dir");

  // Convex mutations for custom upload flow
  const generateUploadUrl      = useMutation(api.files.generateUploadUrl);
  const getStorageUrl          = useMutation(api.files.getStorageUrl);
  const registerUploadedScenes = useMutation(api.scenes.registerUploadedScenes);

  function patch(partial: Partial<SceneMapState>) {
    setState(prev => ({ ...prev, ...partial }));
  }

  // ── PATH A: AI generation ───────────────────────────────────────────────

  const runGenerate = useCallback(async (
    title:      string,
    script:     string,
    timestamps: WordTimestamp[],
  ) => {
    if (!script.trim()) {
      patch({ phase: "error", error: "Script is empty." });
      return;
    }
    if (timestamps.length === 0) {
      patch({ phase: "error", error: "No timestamps — generate audio first." });
      return;
    }

    try {
      patch({ phase: "generating", error: null, sceneCount: null });

      const result = await runSceneMapAction({
        projectId,
        channelId,
        title,
        script,
        timestamps,
        openAiApiKey,
      });

      if (!result.success) {
        patch({ phase: "error", error: result.error ?? "Scene map generation failed." });
        return;
      }

      patch({
        phase:      "done",
        sceneCount: result.sceneCount ?? null,
        generation: result.generation ?? null,
      });

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      patch({ phase: "error", error: message });
    }
  }, [projectId, channelId, openAiApiKey]);

  const generate = useCallback(async (
    title:      string,
    script:     string,
    timestamps: WordTimestamp[],
  ) => {
    setState(INITIAL);
    await runGenerate(title, script, timestamps);
  }, [runGenerate]);

  const regenerate = useCallback(async (
    title:      string,
    script:     string,
    timestamps: WordTimestamp[],
  ) => {
    // Convex bulkInsertScenes auto-increments generation
    // so old scenes are preserved but hidden in listScenes (max generation only)
    setState(INITIAL);
    await runGenerate(title, script, timestamps);
  }, [runGenerate]);

  // ── PATH B: Custom image upload ─────────────────────────────────────────

  /**
   * uploadCustom
   * Uploads images directly, bypassing GPT-4o entirely.
   *
   * For each file:
   *   1. Get a Convex upload URL (generateUploadUrl)
   *   2. PUT the file bytes to that URL
   *   3. Collect { storageId, imageUrl } pairs
   *
   * Then calls registerUploadedScenes in one batch mutation.
   *
   * Files should be sorted by the user's intended order before calling this.
   * The order of the `files` array becomes the uploadOrder in Convex.
   *
   * localImageFolder: derived from baseProjectDir + projectId — the same
   * folder the Python renderer reads from.
   */
  const uploadCustom = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    patch({
      phase:          "uploading",
      error:          null,
      uploadProgress: { current: 0, total: files.length },
    });

    try {
      const uploaded: Array<{
        storageId: Id<"_storage">;
        imageUrl:  string;
        originalFilename: string;
      }> = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // Step 1: Get upload URL from Convex
        const uploadUrl = await generateUploadUrl();

        // Step 2: Upload file bytes
        const res = await fetch(uploadUrl, {
          method:  "POST",
          headers: { "Content-Type": file.type },
          body:    file,
        });

        if (!res.ok) {
          throw new Error(`Upload failed for ${file.name}: ${res.statusText}`);
        }

        const { storageId } = await res.json() as { storageId: Id<"_storage"> };

        // Step 3: Get the public URL for this storage object
        const imageUrl = await getStorageUrl({ storageId }) ?? "";

        uploaded.push({
          storageId,
          imageUrl,
          originalFilename: file.name,
        });

        patch({ uploadProgress: { current: i + 1, total: files.length } });
      }

      // Step 4: Register all scenes in one Convex mutation
      // localImageFolder: where Python will read these files from disk
      // (Convex storage is separate from local disk — for the render pipeline
      //  the files also need to be on disk; handle that in a server action
      //  if needed, or use the Convex URLs directly in the render payload)
      const insertedIds = await registerUploadedScenes({
        projectId,
        scenes: uploaded,
      });

      patch({
        phase:          "done",
        sceneCount:     insertedIds.length,
        uploadProgress: null,
      });

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      patch({ phase: "error", error: message, uploadProgress: null });
    }
  }, [projectId, generateUploadUrl, registerUploadedScenes]);

  // ── Reset ───────────────────────────────────────────────────────────────

  const reset = useCallback(() => setState(INITIAL), []);

  // ─────────────────────────────────────────────────────────────────────────

  return {
    state,
    generate,
    regenerate,
    uploadCustom,
    reset,

    // Convenience booleans
    isIdle:      state.phase === "idle",
    isRunning:   state.phase === "generating" || state.phase === "saving",
    isUploading: state.phase === "uploading",
    isDone:      state.phase === "done",
    isError:     state.phase === "error",
  };
}