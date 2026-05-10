/**
 * types/playground.ts
 * Playground-specific types for audio configuration and rendering
 */

export type AudioEncoding = "MP3" | "LINEAR16" | "OGG_OPUS";

export type MotionType =
  | "zoom_in"
  | "zoom_out"
  | "pan_left"
  | "pan_right"
  | "pan_up"
  | "pan_down"
  | "static";

export interface AudioConfig {
  voiceName: string;
  languageCode: string;
  speakingRate: number;
  pitch: number;
  volumeGainDb: number;
  encoding: AudioEncoding;
}

export interface TimestampWord {
  word: string;
  start: number;
  end: number;
}

export interface Scene {
  scene_index: number;
  image_filename: string;
  subtitle_text: string;
  start_time: number;
  end_time: number;
  duration: number;
  image_prompt: string;
  motion: MotionType;
}
