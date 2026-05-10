"use server";

/**
 * lib/actions/scene-map-action.ts
 *
 * Next.js Server Action — runs on the server only.
 * Orchestrates the scene map pipeline:
 *   1. Call GPT-4o (generateSceneMap)
 *   2. Write scenes to Convex (insertSceneMap action)
 *   3. On failure: record error in Convex (saveSceneMapError action)
 *
 * Called by: useSceneMap hook via startTransition
 */

import { fetchAction }         from "convex/nextjs";
import { api }                 from "@/convex/_generated/api";
import type { Id }             from "@/convex/_generated/dataModel";
import { generateSceneMap }    from "@/lib/services/sceneMap";
import type { WordTimestamp }  from "@/lib/services/voiceover";

export interface SceneMapActionInput {
  projectId:     Id<"projects">;
  channelId:     Id<"channels">;
  title:         string;
  script:        string;
  timestamps:    WordTimestamp[];
  openAiApiKey?: string;        // from channelSetting("openai_api_key")
}

export interface SceneMapActionResult {
  success:     boolean;
  sceneCount?: number;
  generation?: number;
  model?:      string;
  error?:      string;
}

export async function runSceneMapAction(
  input: SceneMapActionInput,
): Promise<SceneMapActionResult> {
  const { projectId, title, script, timestamps, openAiApiKey } = input;

  try {
    // ── Step 1: Call GPT-4o ───────────────────────────────────────────────
    const result = await generateSceneMap(
      title,
      script,
      timestamps,
      openAiApiKey,
    );

    // ── Step 2: Write scenes to Convex ────────────────────────────────────
    // insertSceneMap action handles:
    //   - setSceneMapPending (status flip)
    //   - bulkInsertScenes (generation increment + row inserts)
    //   - setSceneMapReady → pending_images (status chain)
    const { generation } = await fetchAction(api.action.insertSceneMap, {
      projectId,
      scenes: result.scenes.map(s => ({
        sceneIndex:   s.sceneIndex,
        startTime:    s.startTime,
        endTime:      s.endTime,
        duration:     s.duration,
        subtitleText: s.subtitleText,
        imagePrompt:  s.imagePrompt,
        motion:       s.motion,
      })),
    });

    return {
      success:    true,
      sceneCount: result.sceneCount,
      generation,
      model:      result.model,
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    try {
      await fetchAction(api.action.saveSceneMapError, {
        projectId,
        errorMessage: message,
      });
    } catch { /* ignore secondary failure */ }

    return { success: false, error: message };
  }
}