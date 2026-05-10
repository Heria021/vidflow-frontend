/**
 * lib/services/sceneMap.ts
 *
 * Pure GPT-4o scene map service layer.
 * No React. No Convex. No framework dependencies.
 * Runs exclusively in Next.js server actions ('use server').
 *
 * Takes a script + word timestamps → returns structured scene array.
 * The scene array is then written to Convex via convex/actions.ts insertSceneMap.
 *
 * OpenAI key priority:
 *   1. channelSetting "openai_api_key"   (per-channel override)
 *   2. env OPENAI_API_KEY               (global fallback)
 */

import type { WordTimestamp } from "./voiceover";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type MotionType =
  | "zoom_in"
  | "zoom_out"
  | "pan_left"
  | "pan_right"
  | "pan_up"
  | "pan_down"
  | "static";

export interface SceneMapItem {
  sceneIndex:   number;
  imageFilename:string;   // "001.png", "002.png" …
  startTime:    number;
  endTime:      number;
  duration:     number;
  subtitleText: string;
  imagePrompt:  string;
  motion:       MotionType;
}

export interface SceneMapResult {
  scenes:     SceneMapItem[];
  sceneCount: number;
  model:      string;
}


// ─────────────────────────────────────────────────────────────────────────────
// GPT-4o JSON SCHEMA (Structured Outputs)
// ─────────────────────────────────────────────────────────────────────────────

const SCENE_MAP_SCHEMA = {
  name:   "scene_map",
  strict: true,
  schema: {
    type: "object",
    properties: {
      scenes: {
        type:  "array",
        items: {
          type: "object",
          properties: {
            scene_index:    { type: "integer" },
            image_filename: { type: "string"  },
            start_time:     { type: "number"  },
            end_time:       { type: "number"  },
            duration:       { type: "number"  },
            subtitle_text:  { type: "string"  },
            image_prompt:   { type: "string"  },
            motion: {
              type: "string",
              enum: [
                "zoom_in", "zoom_out",
                "pan_left", "pan_right",
                "pan_up",   "pan_down",
                "static",
              ],
            },
          },
          required: [
            "scene_index", "image_filename",
            "start_time",  "end_time", "duration",
            "subtitle_text", "image_prompt", "motion",
          ],
          additionalProperties: false,
        },
      },
    },
    required:             ["scenes"],
    additionalProperties: false,
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `
You are a professional video director creating scene plans for YouTube videos.

You will receive:
  - A video title
  - A narration script
  - Word-level timestamps from Google Chirp TTS (word, start, end in seconds)

Your job is to chunk the narration into visual scenes.

Rules:
- Each scene must be 4 to 8 seconds long
- Use EXACT start_time and end_time values derived from the Chirp timestamps
  (use the start of the first word and end of the last word in each chunk)
- subtitle_text must contain the exact words that fall within that scene's time range
- image_filename follows the pattern: 001.png, 002.png, 003.png … (zero-padded 3 digits)
- image_prompt must be a detailed cinematic 16:9 visual description for an AI image generator
  (describe scene, lighting, style, mood — no text or people unless essential)
- motion must vary — never repeat the same motion more than twice in a row
- static motion is a valid choice for emphasis
- Output ONLY valid JSON matching the schema. No explanation. No markdown.
`.trim();


// ─────────────────────────────────────────────────────────────────────────────
// CREDENTIAL HELPER
// ─────────────────────────────────────────────────────────────────────────────

export function resolveOpenAIKey(channelApiKey?: string): string {
  if (channelApiKey?.trim()) return channelApiKey.trim();
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey?.trim()) return envKey.trim();
  throw new Error(
    "No OpenAI API key found. " +
    "Set openai_api_key in channel settings or OPENAI_API_KEY env var.",
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN SERVICE FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * generateSceneMap
 * Calls GPT-4o with the script + timestamps and returns a structured scene array.
 *
 * @param title           Project title (used in the GPT-4o prompt)
 * @param script          The narration script
 * @param timestamps      Word-level timestamps from synthesizeVoiceover
 * @param channelApiKey   Optional per-channel OpenAI API key
 */
export async function generateSceneMap(
  title:          string,
  script:         string,
  timestamps:     WordTimestamp[],
  channelApiKey?: string,
): Promise<SceneMapResult> {
  if (!script.trim()) {
    throw new Error("Script is empty — cannot generate scene map.");
  }
  if (timestamps.length === 0) {
    throw new Error("Timestamps are empty — generate audio first.");
  }

  const apiKey = resolveOpenAIKey(channelApiKey);

  // ── Build user message ───────────────────────────────────────────────────
  const userMessage = [
    `Video Title: ${title}`,
    ``,
    `Script: ${script}`,
    ``,
    `Chirp Word Timestamps (JSON):`,
    JSON.stringify(timestamps, null, 2),
  ].join("\n");

  // ── Call GPT-4o ──────────────────────────────────────────────────────────
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model:    "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userMessage   },
      ],
      response_format: {
        type:        "json_schema",
        json_schema: SCENE_MAP_SCHEMA,
      },
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as any)?.error?.message ?? `OpenAI API error: ${response.status}`,
    );
  }

  const data = await response.json();
  const raw  = data.choices?.[0]?.message?.content as string;

  if (!raw) {
    throw new Error("GPT-4o returned an empty response.");
  }

  // ── Parse + validate ─────────────────────────────────────────────────────
  let parsed: { scenes: Array<{
    scene_index:    number;
    image_filename: string;
    start_time:     number;
    end_time:       number;
    duration:       number;
    subtitle_text:  string;
    image_prompt:   string;
    motion:         string;
  }> };

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`GPT-4o returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
    throw new Error("GPT-4o returned an empty scenes array.");
  }

  // ── Normalise to our types ───────────────────────────────────────────────
  const scenes: SceneMapItem[] = parsed.scenes.map(s => ({
    sceneIndex:    s.scene_index,
    imageFilename: s.image_filename,
    startTime:     s.start_time,
    endTime:       s.end_time,
    duration:      s.duration,
    subtitleText:  s.subtitle_text,
    imagePrompt:   s.image_prompt,
    motion:        s.motion as MotionType,
  }));

  return {
    scenes,
    sceneCount: scenes.length,
    model:      data.model ?? "gpt-4o",
  };
}