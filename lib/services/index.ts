/**
 * lib/services/index.ts
 * Central export point for all service functions, hooks, and types.
 */

// ── Python Render API ────────────────────────────────────────────────────────
export * from "./render";

// ── Voiceover (Google TTS) ───────────────────────────────────────────────────
export {
  synthesizeVoiceover,
  getVoiceOptions,
  buildTimestamps,
  resolveProjectAudioPath,
  resolveGoogleCredentials,
  VOICE_OPTIONS,
} from "./voiceover";
export type {
  VoiceOption,
  VoiceoverConfig,
  VoiceoverResult,
  WordTimestamp,
} from "./voiceover";

// ── Scene Map (GPT-4o) ───────────────────────────────────────────────────────
export {
  generateSceneMap,
  resolveOpenAIKey,
} from "./sceneMap";
export type {
  SceneMapItem,
  SceneMapResult,
  MotionType,
} from "./sceneMap";

// ── Hooks ────────────────────────────────────────────────────────────────────
export { useRender }     from "./useRender";
export { useVoiceover }  from "./useVoiceover";
export { useSceneMap }   from "./useSceneMap";

export type { RenderState, RenderPhase }       from "./useRender";
export type { VoiceoverState, VoiceoverPhase } from "./useVoiceover";
export type { SceneMapState, SceneMapPhase }   from "./useSceneMap";