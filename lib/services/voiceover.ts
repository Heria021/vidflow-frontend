/**
 * lib/services/voiceover.ts
 *
 * Pure Google Chirp TTS service layer.
 * No React. No Convex. No framework dependencies.
 * Runs exclusively in Next.js server actions ('use server').
 *
 * Credential priority:
 *   1. channelSetting "google_api_key"   (per-channel override)
 *   2. env GOOGLE_API_KEY               (global fallback)
 *   3. env GOOGLE_CREDENTIALS_JSON      (service account JSON string)
 *   4. file at GOOGLE_APPLICATION_CREDENTIALS or ./google-credentials.json
 *
 * Base dir priority:
 *   1. channelSetting "base_project_dir"
 *   2. ~/Documents/VidFlow
 */

import fs   from "fs";
import path from "path";
import os   from "os";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

import { VoiceOption, VOICE_OPTIONS } from "../voice-options";
export { VOICE_OPTIONS };
export type { VoiceOption };

export interface WordTimestamp {
  word:  string;
  start: number;
  end:   number;
}

export interface VoiceoverConfig {
  voiceName:    string;
  languageCode: string;
  speakingRate: number;
  pitch:        number;
  volumeGainDb: number;
  encoding:     "MP3" | "LINEAR16" | "OGG_OPUS";
}

export interface VoiceoverResult {
  audioPath:         string;        // absolute local disk path
  audioDurationSecs: number;        // estimated from last timestamp end
  timestamps:        WordTimestamp[];
  timepointSource:   "chirp" | "estimated";  // for debugging
}

export interface ServiceAccountCredentials {
  client_email: string;
  private_key:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────



const TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1beta1/text:synthesize";
const CHARS_PER_SEC = 15; // fallback estimation rate


// ─────────────────────────────────────────────────────────────────────────────
// CREDENTIAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * resolveServiceAccount
 * Reads service account credentials from env JSON string or file.
 * Returns null if neither is available.
 */
export function resolveServiceAccount(): ServiceAccountCredentials | null {
  // Try env JSON string first (easiest to set in Vercel/Render/etc.)
  const envJson = process.env.GOOGLE_CREDENTIALS_JSON;
  if (envJson) {
    try {
      const parsed = JSON.parse(envJson) as Partial<ServiceAccountCredentials>;
      if (parsed.client_email && parsed.private_key) {
        return { client_email: parsed.client_email, private_key: parsed.private_key };
      }
    } catch { /* fall through */ }
  }

  // Try file path
  const credPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    path.join(process.cwd(), "google-credentials.json");

  if (fs.existsSync(credPath)) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(credPath, "utf-8"),
      ) as Partial<ServiceAccountCredentials>;
      if (parsed.client_email && parsed.private_key) {
        return { client_email: parsed.client_email, private_key: parsed.private_key };
      }
    } catch { /* fall through */ }
  }

  return null;
}

/**
 * getGoogleAccessToken
 * Exchanges service account credentials for a short-lived Bearer token.
 * Uses the google-auth-library JWT flow.
 */
async function getGoogleAccessToken(creds: ServiceAccountCredentials): Promise<string> {
  // Dynamic import so the module is only loaded server-side
  const { JWT } = await import("google-auth-library");
  const jwt = new JWT({
    email:  creds.client_email,
    key:    creds.private_key,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const token = await jwt.getAccessToken();
  if (!token?.token) throw new Error("Failed to obtain Google access token.");
  return token.token;
}

/**
 * resolveGoogleCredentials
 * Returns either { type: "apiKey", key } or { type: "serviceAccount", token }.
 * Throws if neither is available.
 *
 * @param channelApiKey  value from channelSetting("google_api_key"), may be undefined
 */
export async function resolveGoogleCredentials(
  channelApiKey?: string,
): Promise<
  | { type: "apiKey"; key: string }
  | { type: "serviceAccount"; token: string }
> {
  // Priority 1: per-channel API key
  if (channelApiKey?.trim()) {
    return { type: "apiKey", key: channelApiKey.trim() };
  }

  // Priority 2: global env API key
  const envKey = process.env.GOOGLE_API_KEY;
  if (envKey?.trim()) {
    return { type: "apiKey", key: envKey.trim() };
  }

  // Priority 3: service account
  const sa = resolveServiceAccount();
  if (sa) {
    const token = await getGoogleAccessToken(sa);
    return { type: "serviceAccount", token };
  }

  throw new Error(
    "No Google credentials found. " +
    "Set google_api_key in channel settings, GOOGLE_API_KEY env var, " +
    "or provide a service account via GOOGLE_CREDENTIALS_JSON.",
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// PATH HELPER
// ─────────────────────────────────────────────────────────────────────────────

export function resolveProjectAudioPath(
  projectId:        string,
  baseProjectDir?:  string,
): { projectDir: string; audioPath: string } {
  const base       = baseProjectDir?.trim() || path.join(process.cwd(), "media");
  const projectDir = path.join(base, projectId, "audio");
  const audioPath  = path.join(projectDir, "audio.mp3");
  return { projectDir, audioPath };
}


// ─────────────────────────────────────────────────────────────────────────────
// SSML BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildSSML
 * Wraps each word in a <mark> tag so Google TTS returns word-level timepoints.
 * Falls back gracefully on Chirp3-HD voices that ignore SSML marks
 * (handled downstream in buildTimestamps).
 */
function buildSSML(script: string): { ssml: string; words: string[] } {
  const words = script.trim().split(/\s+/);
  const ssml  = `<speak>${words
    .map((w, i) => {
      const escaped = w
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<mark name="${i}"/>${escaped}`;
    })
    .join(" ")}</speak>`;
  return { ssml, words };
}


// ─────────────────────────────────────────────────────────────────────────────
// TIMESTAMP BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildTimestamps
 * Converts raw Google TTS timepoints to our WordTimestamp array.
 *
 * Chirp3-HD voices often return 0 timepoints (known Google limitation).
 * In that case we estimate timestamps from character length — same formula
 * as the original codebase (15 chars/sec, min 0.2s per word).
 */
export function buildTimestamps(
  rawTimepoints: Array<{ markName: string; timeSeconds: number }>,
  words:         string[],
): { timestamps: WordTimestamp[]; source: "chirp" | "estimated" } {
  if (rawTimepoints.length > 0) {
    const timestamps: WordTimestamp[] = rawTimepoints.map((tp, i) => {
      const start   = tp.timeSeconds;
      const end     = rawTimepoints[i + 1]?.timeSeconds ?? start + 0.3;
      const wordIdx = parseInt(tp.markName, 10);
      return {
        word:  words[wordIdx] ?? "",
        start: +start.toFixed(3),
        end:   +end.toFixed(3),
      };
    });
    return { timestamps, source: "chirp" };
  }

  // Fallback estimation
  let cursor = 0;
  const timestamps: WordTimestamp[] = words.map(word => {
    const duration = Math.max(0.2, (word.length + 1) / CHARS_PER_SEC);
    const ts = {
      word,
      start: +cursor.toFixed(3),
      end:   +(cursor + duration).toFixed(3),
    };
    cursor += duration;
    return ts;
  });
  return { timestamps, source: "estimated" };
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN SERVICE FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * synthesizeVoiceover
 * Calls Google TTS, saves audio.mp3 to disk, returns timestamps.
 *
 * @param script        The narration text
 * @param config        Voice settings (from project.voice)
 * @param projectId     Convex project ID — used for folder name
 * @param channelApiKey Optional per-channel Google API key
 * @param baseProjectDir Optional base directory override
 */
export async function synthesizeVoiceover(
  script:         string,
  config:         VoiceoverConfig,
  projectId:      string,
  channelApiKey?: string,
  baseProjectDir?: string,
): Promise<VoiceoverResult> {
  if (!script.trim()) {
    throw new Error("Script is empty — cannot generate audio.");
  }

  // ── Resolve credentials ──────────────────────────────────────────────────
  const creds = await resolveGoogleCredentials(channelApiKey);

  // ── Resolve voice model ──────────────────────────────────────────────────
  const voiceMatch = VOICE_OPTIONS.find(v => v.name === config.voiceName || v.model === config.voiceName);
  const voiceModel = voiceMatch?.model ?? 
    (config.voiceName.includes("-") ? config.voiceName : `en-US-Chirp3-HD-${config.voiceName}`);

  // ── Build SSML ───────────────────────────────────────────────────────────
  const { ssml, words } = buildSSML(script);

  // ── Build TTS payload ────────────────────────────────────────────────────
  const payload = {
    input: { ssml },
    voice: {
      languageCode: config.languageCode,
      name:         voiceModel,
    },
    audioConfig: {
      audioEncoding: config.encoding === "LINEAR16"
        ? "LINEAR16"
        : config.encoding === "OGG_OPUS"
          ? "OGG_OPUS"
          : "MP3",
      speakingRate: config.speakingRate,
      pitch:        config.pitch,
      volumeGainDb: config.volumeGainDb,
    },
    enableTimePointing: ["SSML_MARK"],
  };

  // ── Call TTS API ─────────────────────────────────────────────────────────
  let response: Response;

  if (creds.type === "apiKey") {
    response = await fetch(`${TTS_ENDPOINT}?key=${creds.key}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
  } else {
    response = await fetch(TTS_ENDPOINT, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${creds.token}`,
      },
      body: JSON.stringify(payload),
    });
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as any)?.error?.message ?? `Google TTS API error: ${response.status}`,
    );
  }

  const data = await response.json();

  // ── Save audio to disk ───────────────────────────────────────────────────
  const { projectDir, audioPath } = resolveProjectAudioPath(projectId, baseProjectDir);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(audioPath, Buffer.from(data.audioContent, "base64"));

  // ── Build timestamps ─────────────────────────────────────────────────────
  const rawTimepoints = (data.timepoints ?? []) as Array<{
    markName:    string;
    timeSeconds: number;
  }>;

  const { timestamps, source } = buildTimestamps(rawTimepoints, words);

  const audioDurationSecs = timestamps.length > 0
    ? timestamps[timestamps.length - 1].end
    : 0;

  return {
    audioPath,
    audioDurationSecs,
    timestamps,
    timepointSource: source,
  };
}

/**
 * getVoiceOptions
 * Returns the list of available voice options.
 * Used to populate the voice selector in settings + new channel form.
 */
export function getVoiceOptions(): VoiceOption[] {
  return VOICE_OPTIONS;
}