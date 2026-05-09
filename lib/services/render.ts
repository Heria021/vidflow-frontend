/**
 * lib/services/render.ts
 *
 * Service layer for the VidFlow Python Render API.
 * Handles all HTTP communication with the local Python backend.
 *
 * Base URL: process.env.NEXT_PUBLIC_RENDER_API_URL (default: http://localhost:8000)
 *
 * Endpoints used:
 *   POST   /projects/{id}/render          → start render
 *   GET    /projects/{id}/render          → poll status
 *   GET    /projects/{id}/render/stream   → SSE progress
 *   GET    /projects/{id}/render/download → download video
 *   DELETE /projects/{id}/render          → cancel render
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_RENDER_API_URL ?? "http://localhost:8000";


// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Motion types — must match schema.ts motionType exactly.
 * zoom_in | zoom_out | pan_left | pan_right | pan_up | pan_down | static
 */
export type MotionType =
  | "zoom_in"
  | "zoom_out"
  | "pan_left"
  | "pan_right"
  | "pan_up"
  | "pan_down"
  | "static";

export interface SceneConfig {
  scene_index:   number;
  image_filename: string;
  start_time:    number;
  end_time:      number;
  subtitle_text: string;
  motion:        MotionType;
}

export interface SceneMap {
  scenes: SceneConfig[];
}

export interface RenderRequest {
  scene_map: SceneMap;
}

/**
 * RenderStatus — shape returned by Python's GET /projects/{id}/render.
 *
 * Python status vocabulary:
 *   pending    → job accepted, not started yet  (≈ Convex "queued")
 *   processing → actively rendering             (≈ Convex "rendering")
 *   done       → complete                       (= Convex "done")
 *   error      → failed                         (= Convex "error")
 *   cancelled  → cancelled                      (= Convex "cancelled")
 */
export interface RenderStatus {
  status:        "pending" | "processing" | "done" | "error" | "cancelled";
  progress:      number;       // 0–100
  project_id:    string;
  render_secs?:  number;
  error?:        string;
  output_path?:  string;       // local file path on server
  started_at?:   string;
  completed_at?: string;
}

export interface HealthCheckResponse {
  status:    string;
  message:   string;
  timestamp: string;
}

/**
 * SSEEvent — shape of each event from GET /projects/{id}/render/stream.
 *
 * Three event types:
 *   connected → handshake, confirms stream is live
 *   progress  → intermediate update, progress 0–99
 *   complete  → final event, status is done/error/cancelled
 */
export interface SSEEvent {
  event:        "connected" | "progress" | "complete";
  status:       RenderStatus["status"];
  progress:     number;
  project_id:   string;
  render_secs?: number;
  error?:       string;
  output_path?: string;
}

export interface ErrorResponse {
  detail: string | { msg: string; loc?: string[] }[];
}


// ─────────────────────────────────────────────────────────────────────────────
// ERROR CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class RenderAPIError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly endpoint:   string,
    message:                    string,
  ) {
    super(message);
    this.name = "RenderAPIError";
  }
}

async function handleResponse(response: Response, endpoint: string): Promise<Response> {
  if (response.ok) return response;

  let message = `HTTP ${response.status} ${response.statusText}`;
  try {
    const body: ErrorResponse = await response.json();
    if (typeof body.detail === "string") {
      message = body.detail;
    } else if (Array.isArray(body.detail)) {
      message = body.detail
        .map(e => `${e.msg}${e.loc ? ` (${e.loc.join(".")})` : ""}`)
        .join("; ");
    }
  } catch {
    // keep default message
  }
  throw new RenderAPIError(response.status, endpoint, message);
}


// ─────────────────────────────────────────────────────────────────────────────
// SERVICE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * checkHealth
 * GET /
 * Confirms the Python server is running before attempting a render.
 */
export async function checkHealth(): Promise<HealthCheckResponse> {
  const endpoint = "GET /";
  const response = await fetch(`${API_BASE_URL}/`);
  await handleResponse(response, endpoint);
  return response.json();
}

/**
 * startRender
 * POST /projects/{id}/render
 * Submits a render job. Python starts a background thread and returns 202.
 *
 * pythonProjectId should be the Convex projectId string —
 * same value stored in renderJobs.externalJobId.
 */
export async function startRender(
  pythonProjectId: string,
  sceneMap:        SceneMap,
): Promise<RenderStatus> {
  const endpoint = `POST /projects/${pythonProjectId}/render`;
  const body: RenderRequest = { scene_map: sceneMap };

  const response = await fetch(
    `${API_BASE_URL}/projects/${pythonProjectId}/render`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    },
  );

  await handleResponse(response, endpoint);
  return response.json();
}

/**
 * getRenderStatus
 * GET /projects/{id}/render
 * Single status poll. Use streamRenderProgress for live updates.
 */
export async function getRenderStatus(
  pythonProjectId: string,
): Promise<RenderStatus> {
  const endpoint = `GET /projects/${pythonProjectId}/render`;
  const response = await fetch(
    `${API_BASE_URL}/projects/${pythonProjectId}/render`,
  );
  await handleResponse(response, endpoint);
  return response.json();
}

/**
 * pollRenderStatus
 * Polls GET /projects/{id}/render every intervalMs until terminal status.
 * Use streamRenderProgress instead when possible — SSE is more efficient.
 * Falls back to this when SSE isn't available (e.g. in non-browser environments).
 *
 * @param onProgress  called on every poll tick with the current status
 * @param intervalMs  poll frequency in ms (default 1500)
 * @param timeoutMs   give up after this many ms (default 5 min)
 */
export async function pollRenderStatus(
  pythonProjectId: string,
  onProgress?:     (status: RenderStatus) => void,
  intervalMs       = 1500,
  timeoutMs        = 300_000,
): Promise<RenderStatus> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await getRenderStatus(pythonProjectId);
    onProgress?.(status);

    if (status.status === "done" || status.status === "error" || status.status === "cancelled") {
      return status;
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }

  throw new RenderAPIError(
    408,
    `GET /projects/${pythonProjectId}/render`,
    `Render timed out after ${timeoutMs / 1000}s`,
  );
}

/**
 * streamRenderProgress
 * GET /projects/{id}/render/stream
 *
 * Async generator that yields SSEEvents as they arrive.
 * Terminates automatically when the "complete" event is received.
 *
 * SSE wire format:
 *   event: connected\ndata: {...}\n\n
 *   event: progress\ndata: {...}\n\n
 *   event: complete\ndata: {...}\n\n
 *
 * Usage:
 *   for await (const evt of streamRenderProgress(id)) {
 *     if (evt.event === "complete") break;
 *     setProgress(evt.progress);
 *   }
 */
export async function* streamRenderProgress(
  pythonProjectId: string,
): AsyncGenerator<SSEEvent> {
  const endpoint = `GET /projects/${pythonProjectId}/render/stream`;

  const response = await fetch(
    `${API_BASE_URL}/projects/${pythonProjectId}/render/stream`,
  );
  await handleResponse(response, endpoint);

  if (!response.body) {
    throw new RenderAPIError(500, endpoint, "No response body from SSE stream.");
  }

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE messages are separated by double newlines (\n\n)
      const messages = buffer.split("\n\n");

      // Keep the last incomplete chunk in the buffer
      buffer = messages.pop() ?? "";

      for (const message of messages) {
        if (!message.trim()) continue;

        // Parse each line of the SSE message
        let eventType = "message";
        let dataStr   = "";

        for (const line of message.split("\n")) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            dataStr = line.slice(6).trim();
          }
        }

        if (!dataStr) continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(dataStr);
        } catch {
          continue; // skip malformed frames
        }

        const event: SSEEvent = {
          event:       eventType as SSEEvent["event"],
          status:      (parsed.status    as RenderStatus["status"]) ?? "pending",
          progress:    (parsed.progress  as number) ?? 0,
          project_id:  (parsed.project_id as string) ?? pythonProjectId,
          render_secs: parsed.render_secs as number | undefined,
          error:       parsed.error       as string | undefined,
          output_path: parsed.output_path as string | undefined,
        };

        yield event;

        // Generator terminates after the complete event
        if (eventType === "complete") return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * downloadRender
 * GET /projects/{id}/render/download
 * Returns the full video Blob. For large files use downloadRenderWithProgress.
 */
export async function downloadRender(pythonProjectId: string): Promise<Blob> {
  const endpoint = `GET /projects/${pythonProjectId}/render/download`;
  const response = await fetch(
    `${API_BASE_URL}/projects/${pythonProjectId}/render/download`,
  );
  await handleResponse(response, endpoint);
  return response.blob();
}

/**
 * downloadRenderWithProgress
 * GET /projects/{id}/render/download
 * Streams the video file with byte-level progress tracking.
 * onProgress receives (loaded, total) — total may be 0 if server omits Content-Length.
 */
export async function downloadRenderWithProgress(
  pythonProjectId: string,
  onProgress?:     (loaded: number, total: number) => void,
): Promise<Blob> {
  const endpoint = `GET /projects/${pythonProjectId}/render/download`;

  const response = await fetch(
    `${API_BASE_URL}/projects/${pythonProjectId}/render/download`,
  );
  await handleResponse(response, endpoint);

  if (!response.body) {
    throw new RenderAPIError(500, endpoint, "No response body.");
  }

  const total   = parseInt(response.headers.get("content-length") ?? "0", 10);
  const reader  = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress?.(loaded, total);
    }
  } finally {
    reader.releaseLock();
  }

  // Convert each Uint8Array to a fresh ArrayBuffer to satisfy the BlobPart union
  const buffers = chunks.map(c => c.slice().buffer);
  return new Blob(buffers, { type: "video/mp4" });
}

/**
 * cancelRender
 * DELETE /projects/{id}/render
 *
 * Stops the Python render thread.
 * NOTE: You must ALSO call Convex cancelRenderJob — see useRender.ts.
 */
export async function cancelRender(pythonProjectId: string): Promise<void> {
  const endpoint = `DELETE /projects/${pythonProjectId}/render`;
  const response = await fetch(
    `${API_BASE_URL}/projects/${pythonProjectId}/render`,
    { method: "DELETE" },
  );
  await handleResponse(response, endpoint);
}


// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * validateSceneMap
 * Client-side guard before sending to API.
 * Motion types must match schema.ts motionType exactly.
 */
export const VALID_MOTIONS: MotionType[] = [
  "zoom_in", "zoom_out",
  "pan_left", "pan_right",
  "pan_up",   "pan_down",
  "static",
];

export function validateSceneMap(
  sceneMap: SceneMap,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!sceneMap.scenes || sceneMap.scenes.length === 0) {
    errors.push("Scene map must contain at least one scene.");
    return { valid: false, errors };
  }

  sceneMap.scenes.forEach((scene, i) => {
    const label = `Scene ${i} (index ${scene.scene_index})`;

    if (!scene.image_filename?.trim()) {
      errors.push(`${label}: image_filename cannot be empty.`);
    }

    if (scene.start_time < 0) {
      errors.push(`${label}: start_time cannot be negative.`);
    }

    if (scene.end_time <= scene.start_time) {
      errors.push(`${label}: end_time must be greater than start_time.`);
    }

    if (!VALID_MOTIONS.includes(scene.motion)) {
      errors.push(
        `${label}: invalid motion "${scene.motion}". ` +
        `Valid values: ${VALID_MOTIONS.join(", ")}.`,
      );
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * triggerBrowserDownload
 * Creates a temporary object URL and clicks a hidden anchor to trigger
 * the browser's native Save dialog.
 */
export function triggerBrowserDownload(blob: Blob, filename = "video.mp4"): void {
  const url  = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href     = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * mapPythonStatusToConvex
 * Translates Python's status vocabulary to Convex's renderJobStatus.
 *
 * Python   → Convex
 * pending  → queued
 * processing → rendering
 * done     → done
 * error    → error
 * cancelled → cancelled
 */
export function mapPythonStatusToConvex(
  pythonStatus: RenderStatus["status"],
): "queued" | "rendering" | "done" | "error" | "cancelled" {
  switch (pythonStatus) {
    case "pending":    return "queued";
    case "processing": return "rendering";
    case "done":       return "done";
    case "error":      return "error";
    case "cancelled":  return "cancelled";
  }
}