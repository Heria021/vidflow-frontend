/**
 * lib/services/useRender.ts
 *
 * React hook that orchestrates the full render lifecycle:
 *   Convex (state/persistence) ↔ Python (actual rendering)
 *
 * The hook owns the complete sequence defined in renderJobs.ts:
 *
 *   1. convex.createRenderJob          → creates DB row, project → rendering
 *   2. python.startRender              → POST /projects/{id}/render → 202
 *   3. convex.markRenderingStarted     → job queued → rendering
 *   4. python.streamRenderProgress     → SSE stream → local progress state
 *   5a. python done  → convex.completeRenderJob  → project → done
 *   5b. python error → convex.failRenderJob      → project → error
 *
 *   Cancel:
 *   convex.cancelRenderJob             → DB record
 *   python.cancelRender                → stops thread
 *
 * Python progress (0–99%) lives in local React state only — never in Convex.
 * Convex is only written at the START and END of a render.
 */

"use client";

import { useCallback, useRef, useState }  from "react";
import { useMutation }                     from "convex/react";
import { api }                             from "@/convex/_generated/api";
import type { Id }                         from "@/convex/_generated/dataModel";
import {
  cancelRender,
  downloadRenderWithProgress,
  downloadRender,
  startRender,
  streamRenderProgress,
  pollRenderStatus,
  validateSceneMap,
  triggerBrowserDownload,
  RenderAPIError,
  type RenderStatus,
  type SceneMap,
  type SSEEvent,
}                                          from "./render";


// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type RenderPhase =
  | "idle"           // nothing happening
  | "creating"       // calling Convex createRenderJob
  | "submitting"     // POSTing to Python
  | "rendering"      // SSE stream active, progress updating
  | "completing"     // writing final result to Convex
  | "done"           // render complete
  | "error"          // render failed
  | "cancelling"     // cancel in flight
  | "cancelled"      // cancelled
  | "downloading";   // video download in progress

export interface RenderState {
  phase:            RenderPhase;
  progress:         number;                    // 0–100, from Python SSE
  jobId:            Id<"renderJobs"> | null;   // Convex renderJob ID
  pythonProjectId:  string | null;             // Python API project_id
  outputUrl:        string | null;             // local path from Python
  error:            string | null;
  downloadProgress: { loaded: number; total: number } | null;
}

const INITIAL_STATE: RenderState = {
  phase:            "idle",
  progress:         0,
  jobId:            null,
  pythonProjectId:  null,
  outputUrl:        null,
  error:            null,
  downloadProgress: null,
};


// ─────────────────────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useRender
 *
 * @param projectId  Convex project ID (Id<"projects">)
 *
 * @example
 * const { state, startRender, cancelRender, download, reset } = useRender(projectId);
 *
 * // Trigger a render
 * await startRender(sceneMap);
 *
 * // Watch progress
 * <ProgressBar value={state.progress} />
 *
 * // Download when done
 * if (state.phase === "done") await download();
 */
export function useRender(projectId: Id<"projects">) {
  const [state, setState] = useState<RenderState>(INITIAL_STATE);

  // Convex mutations
  const createRenderJob       = useMutation(api.renderJob.createRenderJob);
  const markRenderingStarted  = useMutation(api.renderJob.markRenderingStarted);
  const completeRenderJob     = useMutation(api.renderJob.completeRenderJob);
  const failRenderJob         = useMutation(api.renderJob.failRenderJob);
  const cancelRenderJob       = useMutation(api.renderJob.cancelRenderJob);

  // Ref to store jobId + pythonProjectId across async steps
  // (avoids stale closure issues in SSE callbacks)
  const jobRef = useRef<{
    jobId:           Id<"renderJobs">;
    pythonProjectId: string;
  } | null>(null);

  // Allows cancelling the SSE fetch mid-stream
  const abortRef = useRef<AbortController | null>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function patch(partial: Partial<RenderState>) {
    setState(prev => ({ ...prev, ...partial }));
  }

  // ── START RENDER ─────────────────────────────────────────────────────────

  /**
   * startRender
   * Runs the full 5-step render sequence.
   * Throws on validation failure. All other errors are caught internally
   * and recorded in state.error — component doesn't need try/catch.
   */
  const handleStartRender = useCallback(async (sceneMap: SceneMap) => {
    // ── Validate scene map first ─────────────────────────────────────────
    const { valid, errors } = validateSceneMap(sceneMap);
    if (!valid) {
      patch({ phase: "error", error: `Validation: ${errors.join("; ")}` });
      throw new RenderAPIError(422, "validateSceneMap", errors.join("; "));
    }

    try {
      // ── Step 1: Convex — create render job ────────────────────────────
      patch({ phase: "creating", progress: 0, error: null, outputUrl: null });

      const { jobId, pythonProjectId } = await createRenderJob({ projectId });
      jobRef.current = { jobId, pythonProjectId };

      patch({ jobId, pythonProjectId });

      // ── Step 2: Python — start render ─────────────────────────────────
      patch({ phase: "submitting" });

      await startRender(pythonProjectId, sceneMap);

      // ── Step 3: Convex — mark as rendering ────────────────────────────
      await markRenderingStarted({ jobId });

      // ── Step 4: Python SSE — stream progress ──────────────────────────
      patch({ phase: "rendering" });

      abortRef.current = new AbortController();
      let finalEvent: SSEEvent | null = null;

      try {
        for await (const event of streamRenderProgress(pythonProjectId)) {
          // Update local progress state — never written to Convex mid-flight
          patch({ progress: event.progress });

          if (event.event === "complete") {
            finalEvent = event;
            break;
          }
        }
      } catch (sseErr) {
        // SSE failed mid-stream — fall back to polling once
        console.warn("SSE stream failed, falling back to poll:", sseErr);
        const polled = await pollRenderStatus(pythonProjectId);
        finalEvent = {
          event:       "complete",
          status:      polled.status,
          progress:    polled.progress,
          project_id:  pythonProjectId,
          render_secs: polled.render_secs,
          error:       polled.error,
          output_path: polled.output_path,
        };
      }

      // ── Step 5: Convex — record final result ──────────────────────────
      patch({ phase: "completing" });

      if (!finalEvent) {
        throw new Error("SSE stream closed without a complete event.");
      }

      if (finalEvent.status === "done") {
        const outputUrl = finalEvent.output_path ?? "";

        await completeRenderJob({
          jobId,
          projectId,
          outputUrl,
          // fileSizeBytes and durationSecs are not in the SSE event —
          // they'd need a final GET /status poll to get exact values.
          // For now we skip them; they can be filled later from the download.
        });

        patch({ phase: "done", progress: 100, outputUrl });

      } else {
        // error or cancelled from Python's side
        const errorMessage = finalEvent.error ?? "Render failed.";

        await failRenderJob({
          jobId,
          projectId,
          errorMessage,
          errorStage: "render",
        });

        patch({ phase: "error", error: errorMessage });
      }

    } catch (err) {
      // Unexpected error anywhere in the chain
      const message = err instanceof Error ? err.message : String(err);

      patch({ phase: "error", error: message });

      // Best-effort: record failure in Convex if we have a job ID
      if (jobRef.current) {
        try {
          await failRenderJob({
            jobId:        jobRef.current.jobId,
            projectId,
            errorMessage: message,
            errorStage:   "render",
          });
        } catch {
          // failRenderJob is idempotent — if it throws, ignore
        }
      }

      throw err;
    }
  }, [
    projectId,
    createRenderJob,
    markRenderingStarted,
    completeRenderJob,
    failRenderJob,
  ]);

  // ── CANCEL ───────────────────────────────────────────────────────────────

  /**
   * handleCancelRender
   * 1. Calls Convex cancelRenderJob  → records cancellation, project → error/render
   * 2. Calls Python DELETE /render   → stops the render thread
   * Both must happen. Order: Convex first (so state is consistent even if Python call fails).
   */
  const handleCancelRender = useCallback(async () => {
    const job = jobRef.current;
    if (!job) return;

    patch({ phase: "cancelling" });

    try {
      // Convex first
      await cancelRenderJob({ jobId: job.jobId, projectId });

      // Then Python
      try {
        await cancelRender(job.pythonProjectId);
      } catch (pyErr) {
        // Python may return 404 if the job already finished — that's fine
        console.warn("Python cancel returned an error (may be already done):", pyErr);
      }

      patch({ phase: "cancelled" });

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      patch({ phase: "error", error: message });
      throw err;
    }
  }, [projectId, cancelRenderJob]);

  // ── DOWNLOAD ─────────────────────────────────────────────────────────────

  /**
   * handleDownload
   * Downloads the rendered video from Python's download endpoint.
   * Triggers the browser's native Save dialog.
   *
   * @param filename  Suggested filename for the download dialog
   */
  const handleDownload = useCallback(async (filename = "video.mp4") => {
    const job = jobRef.current;
    if (!job) {
      throw new RenderAPIError(400, "download", "No active render job.");
    }
    if (state.phase !== "done") {
      throw new RenderAPIError(400, "download", "Render is not complete yet.");
    }

    patch({ phase: "downloading", downloadProgress: null });

    try {
      const blob = await downloadRenderWithProgress(
        job.pythonProjectId,
        (loaded, total) => patch({ downloadProgress: { loaded, total } }),
      );

      triggerBrowserDownload(blob, filename);
      patch({ phase: "done", downloadProgress: null });

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      patch({ phase: "error", error: message, downloadProgress: null });
      throw err;
    }
  }, [state.phase]);

  // ── RESET ────────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    abortRef.current?.abort();
    jobRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────

  return {
    state,

    // Actions
    startRender:  handleStartRender,
    cancelRender: handleCancelRender,
    download:     handleDownload,
    reset:        handleReset,

    // Convenience booleans for UI
    isIdle:       state.phase === "idle",
    isRunning:    state.phase === "creating"  ||
                  state.phase === "submitting" ||
                  state.phase === "rendering"  ||
                  state.phase === "completing",
    isDone:       state.phase === "done",
    isError:      state.phase === "error",
    isCancelled:  state.phase === "cancelled",
    isDownloading:state.phase === "downloading",
    canCancel:    state.phase === "submitting" || state.phase === "rendering",
    canDownload:  state.phase === "done",
    canRetry:     state.phase === "error" || state.phase === "cancelled",
  };
}

// Re-export types consumers need
export type { RenderStatus, SceneMap, SSEEvent, RenderAPIError };