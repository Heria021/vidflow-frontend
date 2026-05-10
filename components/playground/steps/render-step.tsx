"use client"

import * as React          from "react"
import { useQuery, useMutation } from "convex/react"
import { Button }          from "@/components/ui/button"
import { Progress }        from "@/components/ui/progress"
import { api }             from "@/convex/_generated/api"
import { streamRenderProgress } from "@/lib/services/render"
import type { RenderStatus }    from "@/lib/services/render"

interface UploadedFile {
  id:       string
  name:     string
  preview?: string
}

interface RenderStepProps {
  projectId:     string
  projectTitle:  string
  uploadedFiles: UploadedFile[]
  onReset:       () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER STEP
//
// Progress source:
//   Mid-render (0–99%): Python SSE stream via streamRenderProgress()
//   Final state (done/error/cancelled): Convex renderJob query
//
// The Convex query is the persistent source of truth for whether a render
// completed. The SSE stream is ephemeral — it only exists while Python is
// actively rendering in memory.
// ─────────────────────────────────────────────────────────────────────────────

export function RenderStep({ projectId, projectTitle, uploadedFiles, onReset }: RenderStepProps) {
  // ── Convex — persistent state ──────────────────────────────────────────
  const renderJob    = useQuery(api.renderJob.getLatestRenderJob, { projectId: projectId as any })
  const completeJob  = useMutation(api.renderJob.completeRenderJob)
  const failJob      = useMutation(api.renderJob.failRenderJob)
  const cancelJob    = useMutation(api.renderJob.cancelRenderJob)

  // ── Local — live SSE progress (Python in-memory, not persisted) ────────
  const [liveProgress, setLiveProgress] = React.useState<number | null>(null)
  const [sseStatus,    setSseStatus]    = React.useState<RenderStatus["status"] | null>(null)
  const [errorMsg,     setErrorMsg]     = React.useState("")
  const [outputPath,   setOutputPath]   = React.useState<string | null>(null)

  const sseAbortRef = React.useRef<AbortController | null>(null)

  // ── Derived state ───────────────────────────────────────────────────────
  const pythonProjectId = renderJob?.externalJobId ?? projectId
  const convexStatus    = renderJob?.status ?? null

  // Final state from Convex takes precedence over SSE
  const isDone      = convexStatus === "done"
  const isError     = convexStatus === "error" || convexStatus === "cancelled"
  const isRendering = !isDone && !isError && convexStatus !== null

  // Progress: use SSE live value while rendering, 100 when done, 0 otherwise
  const displayProgress = isDone
    ? 100
    : liveProgress !== null
      ? liveProgress
      : (convexStatus === "rendering" || convexStatus === "queued") ? 5 : 0

  // ── SSE stream — start when render job appears ─────────────────────────
  React.useEffect(() => {
    // Only stream when we have an active job
    if (!renderJob || isDone || isError) return
    if (convexStatus !== "rendering" && convexStatus !== "queued") return

    // Don't start a second stream if one is already running
    if (sseAbortRef.current) return

    let cancelled = false
    const controller = new AbortController()
    sseAbortRef.current = controller

    async function consumeStream() {
      try {
        for await (const event of streamRenderProgress(pythonProjectId)) {
          if (cancelled) break

          if (event.event === "progress" || event.event === "connected") {
            setLiveProgress(event.progress)
            setSseStatus(event.status)
          }

          if (event.event === "complete") {
            setLiveProgress(event.progress)
            setSseStatus(event.status)

            if (event.status === "done" && renderJob) {
              // Write final result to Convex
              await completeJob({
                jobId:        renderJob._id,
                projectId:    projectId as any,
                outputUrl:    event.output_path ?? "",
                durationSecs: event.render_secs,
              })
              setOutputPath(event.output_path ?? null)
            } else if (event.status === "error" && renderJob) {
              await failJob({
                jobId:        renderJob._id,
                projectId:    projectId as any,
                errorMessage: event.error ?? "Render failed",
                errorStage:   "render",
              })
              setErrorMsg(event.error ?? "Render failed")
            }
            break
          }
        }
      } catch (err) {
        if (cancelled) return
        // SSE failed mid-stream — don't crash, just show last known progress
        console.warn("[RenderStep] SSE stream error:", err)
      } finally {
        sseAbortRef.current = null
      }
    }

    consumeStream()

    return () => {
      cancelled = true
      controller.abort()
      sseAbortRef.current = null
    }
  // Re-run only when jobId changes (new render started) or status changes to rendering
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderJob?._id, convexStatus])

  // ── Sync error from Convex (e.g. cancelled from another tab) ───────────
  React.useEffect(() => {
    if (renderJob?.status === "error" && renderJob.errorMessage && !errorMsg) {
      setErrorMsg(renderJob.errorMessage)
    }
    if (renderJob?.status === "cancelled" && !errorMsg) {
      setErrorMsg("Render was cancelled")
    }
  }, [renderJob?.status, renderJob?.errorMessage])

  // ── Cancel ──────────────────────────────────────────────────────────────
  async function handleCancel() {
    if (!renderJob) return

    // Stop SSE stream first
    if (sseAbortRef.current) {
      sseAbortRef.current.abort()
      sseAbortRef.current = null
    }

    try {
      // Cancel in Convex
      await cancelJob({
        jobId:     renderJob._id,
        projectId: projectId as any,
      })

      // Cancel in Python — best effort
      try {
        await fetch(
          `${process.env.NEXT_PUBLIC_RENDER_API_URL ?? "http://localhost:8000"}/projects/${pythonProjectId}/render`,
          { method: "DELETE" },
        )
      } catch {
        // Python may have already finished — not a fatal error
      }

      setErrorMsg("Render cancelled")
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to cancel render.")
    }
  }

  // ── Download ─────────────────────────────────────────────────────────────
  // FIX: use Python's download endpoint directly — there is no /api/video route.
  // Python serves the file at GET /projects/{id}/render/download.
  function handleDownload() {
    const url = `${process.env.NEXT_PUBLIC_RENDER_API_URL ?? "http://localhost:8000"}/projects/${pythonProjectId}/render/download`
    const a       = document.createElement("a")
    a.href        = url
    a.download    = `${projectTitle.replace(/\s+/g, "_")}.mp4`
    a.target      = "_blank"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  // ── Status label ─────────────────────────────────────────────────────────
  const statusLabel = isDone
    ? "Render complete!"
    : isError
      ? "Render failed"
      : sseStatus === "processing"
        ? "Rendering video…"
        : sseStatus === "pending"
          ? "Queued…"
          : "Starting render…"

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-400">

      {/* Status banner */}
      <div className="flex flex-col items-center gap-3 py-10">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-muted/40 text-2xl">
          {isDone ? "✅" : isError ? "❌" : "🎬"}
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold">{projectTitle}</p>
          <p className="text-xs text-muted-foreground">{statusLabel}</p>
        </div>

        {/* Progress bar — only while rendering */}
        {!isDone && !isError && (
          <div className="w-full max-w-sm space-y-1.5">
            <Progress
              value={displayProgress}
              className="h-2 transition-all duration-500"
            />
            <p className="text-center text-[10px] text-muted-foreground tabular-nums">
              {liveProgress !== null ? `${Math.round(liveProgress)}%` : "Starting…"}
            </p>
          </div>
        )}
      </div>

      {/* Uploaded image thumbnails */}
      {uploadedFiles.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {uploadedFiles.map(f => (
            <div key={f.id} className="rounded-md border border-border overflow-hidden bg-muted/20">
              {f.preview
                ? <img src={f.preview} alt={f.name} className="w-full h-24 object-cover" />
                : <div className="w-full h-24 flex items-center justify-center text-2xl bg-muted">🖼</div>
              }
              <p className="text-[10px] text-muted-foreground truncate px-2 py-1">{f.name}</p>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {(isError || errorMsg) && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMsg || renderJob?.errorMessage || "The render pipeline encountered an error."}
        </div>
      )}

      {/* Render stats when done */}
      {isDone && renderJob?.renderTimeSecs && (
        <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
          <span>Rendered in {renderJob.renderTimeSecs.toFixed(1)}s</span>
          {renderJob.fileSizeBytes && (
            <span>{(renderJob.fileSizeBytes / 1_048_576).toFixed(2)} MB</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 mt-auto">
        <Button variant="outline" size="sm" onClick={onReset}>
          ← Start over
        </Button>

        <div className="flex items-center gap-2">
          {isRendering && (
            <Button variant="destructive" size="sm" onClick={handleCancel}>
              ✕ Cancel
            </Button>
          )}
          {isDone && (
            <Button size="lg" className="py-5 text-sm font-semibold" onClick={handleDownload}>
              Download Video
            </Button>
          )}
        </div>
      </div>

    </div>
  )
}