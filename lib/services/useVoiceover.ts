"use client";

/**
 * lib/services/useVoiceover.ts
 *
 * React hook that orchestrates the full voiceover lifecycle.
 *
 * Flow:
 *   1. Calls Next.js server action (runVoiceoverAction)
 *      → server action calls Google TTS (synthesizeVoiceover)
 *      → server action calls Convex action (saveAudioResult)
 *      → Convex writes audio metadata + timestamps
 *      → Convex advances project: audio_pending → audio_ready
 *
 * The hook manages local UI state (phase, error).
 * Convex manages persistent state (project.audioUrl, project.timestamps).
 *
 * Supports:
 *   generate()    — first-time generation
 *   regenerate()  — re-run TTS (resets and re-generates)
 */

import { useCallback, useState }      from "react";
import { useAction, useMutation }      from "convex/react";
import { api }                         from "@/convex/_generated/api";
import type { Id }                     from "@/convex/_generated/dataModel";
import type { VoiceoverConfig }        from "./voiceover";
import { runVoiceoverAction } from "../actions/voiceover-actions";
import { useChannelSetting } from "@/providers/ChannelContext";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type VoiceoverPhase =
  | "idle"
  | "generating"    // TTS in flight
  | "saving"        // writing to Convex
  | "done"
  | "error";

export interface VoiceoverState {
  phase:             VoiceoverPhase;
  error:             string | null;
  audioPath:         string | null;
  audioDurationSecs: number | null;
  timepointSource:   "chirp" | "estimated" | null;
}

const INITIAL: VoiceoverState = {
  phase:             "idle",
  error:             null,
  audioPath:         null,
  audioDurationSecs: null,
  timepointSource:   null,
};

// ─────────────────────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useVoiceover
 *
 * @param projectId  Convex project ID
 * @param channelId  Convex channel ID — used to read channelSettings
 *
 * @example
 * const { state, generate, regenerate, isRunning, isDone, isError } =
 *   useVoiceover(projectId, channelId);
 *
 * await generate(script, voiceConfig);
 */
export function useVoiceover(
  projectId: Id<"projects">,
  channelId: Id<"channels">,
) {
  const [state, setState] = useState<VoiceoverState>(INITIAL);

  // Read per-channel API key + base dir from channelSettings
  const googleApiKey   = useChannelSetting("google_api_key");
  const baseProjectDir = useChannelSetting("base_project_dir");

  // Convex mutation to set audio_pending immediately (before server action runs)
  const setAudioPending = useMutation(api.projects.setAudioPending);

  function patch(partial: Partial<VoiceoverState>) {
    setState(prev => ({ ...prev, ...partial }));
  }

  // ── Core generate logic ─────────────────────────────────────────────────

  const runGenerate = useCallback(async (
    script: string,
    config: VoiceoverConfig,
  ) => {
    if (!script.trim()) {
      patch({ phase: "error", error: "Script is empty." });
      return;
    }

    try {
      // Flip project to audio_pending immediately — UI reacts before server
      patch({ phase: "generating", error: null, audioPath: null });
      await setAudioPending({ projectId });

      // Call the server action (TTS + Convex write)
      const result = await runVoiceoverAction({
        projectId,
        channelId,
        script,
        config,
        googleApiKey,
        baseProjectDir,
      });

      if (!result.success) {
        patch({ phase: "error", error: result.error ?? "Voiceover generation failed." });
        return;
      }

      patch({
        phase:             "done",
        audioPath:         result.audioPath ?? null,
        audioDurationSecs: result.audioDurationSecs ?? null,
        timepointSource:   result.timepointSource ?? null,
      });

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      patch({ phase: "error", error: message });
    }
  }, [projectId, channelId, googleApiKey, baseProjectDir, setAudioPending]);

  // ── Public API ──────────────────────────────────────────────────────────

  const generate = useCallback(async (
    script: string,
    config: VoiceoverConfig,
  ) => {
    setState(INITIAL);
    await runGenerate(script, config);
  }, [runGenerate]);

  const regenerate = useCallback(async (
    script: string,
    config: VoiceoverConfig,
  ) => {
    // Same as generate — Convex handles the state reset
    // setAudioPending will move status back to audio_pending regardless of current status
    setState(INITIAL);
    await runGenerate(script, config);
  }, [runGenerate]);

  const reset = useCallback(() => setState(INITIAL), []);

  return {
    state,
    generate,
    regenerate,
    reset,

    // Convenience booleans
    isIdle:      state.phase === "idle",
    isRunning:   state.phase === "generating" || state.phase === "saving",
    isDone:      state.phase === "done",
    isError:     state.phase === "error",
  };
}