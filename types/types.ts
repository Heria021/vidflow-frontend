/**
 * types/types.ts
 * Core application types shared across the codebase
 */

export type ProjectStatus =
  | "draft"
  | "audio_pending"
  | "audio_ready"
  | "scene_map_pending"
  | "scene_map_ready"
  | "pending_images"
  | "rendering"
  | "done"
  | "error";

export type RenderResolution = "720p" | "1080p" | "4K";
export type RenderFps = 24 | 30 | 60;
export type RenderFormat = "mp4" | "webm";

export interface RenderConfig {
  resolution: RenderResolution;
  fps: RenderFps;
  format: RenderFormat;
}

export interface VoiceConfig {
  voiceName: string;
  voiceModel: string;
  languageCode: string;
  speakingRate: number;
  pitch: number;
  volumeGainDb: number;
  encoding: "MP3" | "LINEAR16" | "OGG_OPUS";
}

export interface Project {
  id: string;
  channelId: string;
  title: string;
  script?: string;
  description?: string;
  audioUrl?: string;
  audioDurationSecs?: number;
  outputUrl?: string;
  outputSizeBytes?: number;
  outputDurationSecs?: number;
  voice: VoiceConfig;
  render: RenderConfig;
  status: ProjectStatus;
  errorMessage?: string;
  totalImages: number;
  imagesConfirmed: number;
  createdAt: number;
  updatedAt: number;
}
