"use server";

/**
 * lib/actions/voiceover-action.ts
 *
 * Next.js Server Action — runs on the server only.
 * Orchestrates the full voiceover pipeline:
 *   1. Call Google Chirp TTS (synthesizeVoiceover)
 *   2. Save result to Convex (saveAudioResult action)
 *   3. On failure: record error in Convex (saveAudioError action)
 *
 * Why a server action and not an API route?
 *   - Server actions are callable directly from client components
 *   - They run in Node.js (needed for fs, google-auth-library)
 *   - No need for a separate API endpoint
 *
 * Called by: useVoiceover hook via startTransition
 */

import { fetchAction }          from "convex/nextjs";
import { api }                  from "@/convex/_generated/api";
import type { Id }              from "@/convex/_generated/dataModel";
import { synthesizeVoiceover }  from "@/lib/services/voiceover";
import type { VoiceoverConfig } from "@/lib/services/voiceover";

export interface VoiceoverActionInput {
  projectId:      Id<"projects">;
  channelId:      Id<"channels">;
  script:         string;
  config:         VoiceoverConfig;
  // Optional overrides — pulled from channelSettings if not provided
  googleApiKey?:  string;
  baseProjectDir?: string;
}

export interface VoiceoverActionResult {
  success:           boolean;
  audioPath?:        string;
  audioDurationSecs?: number;
  timepointSource?:  "chirp" | "estimated";
  error?:            string;
}

export async function runVoiceoverAction(
  input: VoiceoverActionInput,
): Promise<VoiceoverActionResult> {
  const { projectId, script, config, googleApiKey, baseProjectDir } = input;

  try {
    // ── Step 1: Set audio_pending in Convex ───────────────────────────────
    // We call this mutation directly so the UI sees the status flip immediately.
    // The public setAudioPending mutation needs to be added to projects.ts.
    // For now we rely on the action to set status via saveAudioResult.

    // ── Step 2: Call Google TTS ───────────────────────────────────────────
    const result = await synthesizeVoiceover(
      script,
      config,
      projectId,       // used as folder name on disk
      googleApiKey,
      baseProjectDir,
    );

    // ── Step 3: Write result to Convex ────────────────────────────────────
    await fetchAction(api.action.saveAudioResult, {
      projectId,
      audioUrl:          result.audioPath,
      audioDurationSecs: result.audioDurationSecs,
      timestamps:        result.timestamps,
    });

    return {
      success:           true,
      audioPath:         result.audioPath,
      audioDurationSecs: result.audioDurationSecs,
      timepointSource:   result.timepointSource,
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Best-effort: record error in Convex
    try {
      await fetchAction(api.action.saveAudioError, {
        projectId,
        errorMessage: message,
      });
    } catch { /* ignore secondary failure */ }

    return { success: false, error: message };
  }
}