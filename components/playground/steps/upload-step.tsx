"use client"

import * as React from "react"
import { Check, Upload, X, FolderOpen, AlertCircle, ImageOff, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { useMutation } from "convex/react"

import { Badge }    from "@/components/ui/badge"
import { Button }   from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { cn }       from "@/lib/utils"
import { api }      from "@/convex/_generated/api"

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Scene {
  scene_index:    number
  image_filename: string
  subtitle_text:  string
  start_time:     number
  end_time:       number
}

export interface UploadedFile {
  id:         string
  name:       string
  size:       number
  type:       string
  status:     "ready" | "error"
  error?:     string
  file?:      File
  preview?:   string
  sceneIndex: number
}

interface Slot {
  scene:   Scene
  file:    File | null
  preview: string | null
  matched: boolean
}

type UploadStatus = "idle" | "uploading" | "signaling" | "done" | "error"

interface UploadStepProps {
  projectId:         string
  projectName:       string
  totalImagesNeeded: number
  scenes:            Scene[]
  onDone:            (files: UploadedFile[]) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fmtSize(bytes: number) {
  if (bytes === 0) return "0 B"
  const k = 1024
  const s = ["B", "KB", "MB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Math.round((bytes / Math.pow(k, i)) * 10) / 10} ${s[i]}`
}

function getPreview(file: File): Promise<string> {
  return new Promise((res) => {
    const r = new FileReader()
    r.onload = (e) => res(e.target?.result as string)
    r.readAsDataURL(file)
  })
}

function buildSlots(scenes: Scene[]): Slot[] {
  return scenes.map((scene) => ({ scene, file: null, preview: null, matched: false }))
}

// ─────────────────────────────────────────────────────────────────────────────
// SLOT CARD
// ─────────────────────────────────────────────────────────────────────────────

function SlotCard({ slot, index, onRemove }: { slot: Slot; index: number; onRemove: () => void }) {
  return (
    <div className={cn(
      "group relative rounded-lg border overflow-hidden transition-all",
      slot.matched
        ? "border-border shadow-sm"
        : "border-dashed border-muted-foreground/25 opacity-60",
    )}>
      <div className="aspect-video w-full bg-muted/40 relative overflow-hidden">
        {slot.preview ? (
          <img
            src={slot.preview}
            alt={slot.scene.image_filename}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1.5">
            <ImageOff className="h-5 w-5 text-muted-foreground/25" />
            <span className="text-[10px] text-muted-foreground/40">No match</span>
          </div>
        )}
        <span className="absolute top-1.5 left-1.5 font-mono text-[10px] bg-background/85 backdrop-blur-sm px-1.5 py-0.5 rounded border border-border/60">
          {String(index + 1).padStart(2, "0")}
        </span>
        {slot.matched && (
          <span className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 shadow">
            <Check className="h-3 w-3 text-white" />
          </span>
        )}
        {slot.matched && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className={cn(
              "absolute bottom-1.5 right-1.5 h-5 w-5 rounded-full",
              "bg-background/80 backdrop-blur-sm border border-border/60",
              "flex items-center justify-center",
              "opacity-0 group-hover:opacity-100 transition-opacity",
              "hover:bg-destructive hover:text-white hover:border-destructive",
            )}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
      <div className="px-2.5 py-2 space-y-1 bg-muted/20">
        <p className="font-mono text-[10px] text-muted-foreground truncate">
          {slot.scene.image_filename}
        </p>
        <p className="text-[11px] text-foreground/80 line-clamp-1 leading-snug">
          {slot.scene.subtitle_text}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-muted-foreground/60">
            {slot.scene.start_time.toFixed(2)}s → {slot.scene.end_time.toFixed(2)}s
          </span>
          {slot.file && (
            <span className="text-[10px] text-muted-foreground/50">
              {fmtSize(slot.file.size)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function UploadStep({ projectId, projectName, totalImagesNeeded, scenes, onDone }: UploadStepProps) {
  const [slots,        setSlots]        = React.useState<Slot[]>(() => buildSlots(scenes))
  const [isDragActive, setIsDragActive] = React.useState(false)
  const [uploadStatus, setUploadStatus] = React.useState<UploadStatus>("idle")
  const [uploadProgress, setUploadProgress] = React.useState(0)
  const folderInputRef = React.useRef<HTMLInputElement>(null)

  // FIX: track previews in a ref so we can revoke them on unmount
  // The previous cleanup only ran when `slots` changed, missing unmount revokes.
  const previewUrlsRef = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    return () => {
      // Revoke all object URLs on unmount
      previewUrlsRef.current.forEach((url) => {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url)
      })
      previewUrlsRef.current.clear()
    }
  }, [])

  const matchedSlots    = slots.filter((s) => s.matched)
  const matchedCount    = matchedSlots.length
  const unmatchedNeeded = scenes
    .filter((sc) => !slots.find((sl) => sl.scene.image_filename === sc.image_filename && sl.matched))
    .map((sc) => sc.image_filename)

  // FIX: require ALL images to be matched before allowing upload.
  // Previously canUpload = matchedCount > 0, which allowed partial uploads
  // that would cause the render to fail.
  const canProceed  = matchedCount === totalImagesNeeded
  const canUpload   = canProceed && uploadStatus === "idle"
  const progressPct = totalImagesNeeded > 0 ? Math.round((matchedCount / totalImagesNeeded) * 100) : 0
  const hasAny      = matchedCount > 0

  // ── Process files → match to scene filenames ────────────────────────────
  async function processFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList).filter((f) => f.type.startsWith("image/"))
    if (!incoming.length) {
      toast.error("No images found", { description: "Please select image files (JPEG, PNG, WebP)" })
      return
    }

    const byName = new Map<string, File>()
    for (const f of incoming) byName.set(f.name, f)

    const existingMatches = new Set(
      slots.filter((s) => s.matched).map((s) => s.scene.image_filename),
    )

    let newMatches = 0
    const updated = await Promise.all(
      slots.map(async (slot) => {
        const file = byName.get(slot.scene.image_filename)
        if (!file || existingMatches.has(slot.scene.image_filename)) return slot
        newMatches++
        const preview = await getPreview(file)
        // Track the data URL for potential cleanup
        if (preview.startsWith("blob:")) previewUrlsRef.current.add(preview)
        return { ...slot, file, preview, matched: true }
      }),
    )

    setSlots(updated)

    const unmatched = incoming.filter((f) => !scenes.find((s) => s.image_filename === f.name))
    if (newMatches === 0) {
      toast.error("No filenames matched", {
        description: "Rename your images to match the scene filenames (e.g. 001.png)",
      })
    } else if (unmatched.length > 0) {
      toast.warning(`${newMatches} matched, ${unmatched.length} unrecognised`)
    } else {
      toast.success(`${newMatches} image${newMatches !== 1 ? "s" : ""} matched`, {
        description: newMatches === totalImagesNeeded
          ? "All scenes covered!"
          : `${totalImagesNeeded - newMatches} scene${totalImagesNeeded - newMatches !== 1 ? "s" : ""} still need images`,
      })
    }
  }

  // ── Drag handlers ───────────────────────────────────────────────────────
  function handleDrag(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation()
    setIsDragActive(e.type === "dragenter" || e.type === "dragover")
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation()
    setIsDragActive(false)
    const files: File[] = []
    for (let i = 0; i < e.dataTransfer.items.length; i++) {
      const f = e.dataTransfer.items[i].getAsFile()
      if (f) files.push(f)
    }
    processFiles(files.length ? files : e.dataTransfer.files)
  }

  function removeSlot(idx: number) {
    setSlots((prev) => prev.map((s, i) =>
      i === idx ? { ...s, file: null, preview: null, matched: false } : s,
    ))
  }

  function clearAll() {
    setSlots(buildSlots(scenes))
    setUploadProgress(0)
    setUploadStatus("idle")
    if (folderInputRef.current) folderInputRef.current.value = ""
  }

  // ── Convex mutations ────────────────────────────────────────────────────
  const generateUploadUrl      = useMutation(api.files.generateUploadUrl)
  const getStorageUrl          = useMutation(api.files.getStorageUrl)
  const registerUploadedScenes = useMutation(api.scenes.registerUploadedScenes)
  const createRenderJob        = useMutation(api.renderJob.createRenderJob)

  // ── Upload & render ─────────────────────────────────────────────────────
  async function handleUploadAndRender() {
    // Guard: all images must be matched
    if (!canProceed) {
      toast.error("All images must be matched before uploading")
      return
    }

    const filesToUpload = matchedSlots.map((s) => s.file!).filter(Boolean)
    if (!filesToUpload.length) return

    setUploadStatus("uploading")
    setUploadProgress(5)

    const uploadToastId = toast.loading("Saving files locally…", {
      description: `Sending ${filesToUpload.length} file${filesToUpload.length !== 1 ? "s" : ""} to media folder`,
    })

    try {
      // ── Step 0: upload to local Next.js server ─────────────────────────
      const formData = new FormData()
      formData.append("projectId", projectId)
      for (const file of filesToUpload) formData.append("files", file)

      const localResponse = await fetch("/api/upload", { method: "POST", body: formData })
      if (!localResponse.ok) throw new Error("Local upload failed")
      const localResult = await localResponse.json()
      const localImageFolder = localResult.localImageFolder

      // ── Step 1: upload to Convex storage ──────────────────────────────
      toast.loading("Uploading to cloud…", { id: uploadToastId, description: "Backing up images" })

      const scenesToRegister: Array<{
        storageId:        any
        imageUrl:         string
        originalFilename?: string
      }> = []

      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i]
        setUploadProgress(Math.min(10 + (i / filesToUpload.length) * 40, 50))

        const uploadUrl = await generateUploadUrl()
        const response  = await fetch(uploadUrl, {
          method:  "POST",
          headers: { "Content-Type": file.type },
          body:    file,
        })
        if (!response.ok) throw new Error(`Failed to upload ${file.name}: ${response.statusText}`)

        const { storageId } = await response.json()
        const imageUrl      = await getStorageUrl({ storageId })
        if (!imageUrl) throw new Error(`Failed to get URL for ${file.name}`)

        scenesToRegister.push({ storageId, imageUrl, originalFilename: file.name })
      }

      setUploadProgress(55)

      // ── Step 2: register scenes in Convex ─────────────────────────────
      toast.loading("Registering images…", { id: uploadToastId, description: "Saving to database" })

      const sceneIds = await registerUploadedScenes({
        projectId: projectId as any,
        localImageFolder,
        scenes:    scenesToRegister,
      })

      setUploadProgress(75)
      toast.success("Images registered", {
        id:          uploadToastId,
        description: `${sceneIds.length} scene${sceneIds.length !== 1 ? "s" : ""} registered`,
      })

      // ── Step 3: create render job ──────────────────────────────────────
      setUploadStatus("signaling")

      const signalToastId = toast.loading("Starting render…", {
        description: "Preparing render pipeline",
      })

      const renderResult = await createRenderJob({ projectId: projectId as any })

      // ── Step 4: kick off Python renderer ──────────────────────────────
      // Build the scene_map payload Python expects
      const sceneMap = {
        scenes: matchedSlots.map((slot, i) => ({
          scene_index:    slot.scene.scene_index,
          image_filename: slot.scene.image_filename,
          start_time:     slot.scene.start_time,
          end_time:       slot.scene.end_time,
          subtitle_text:  slot.scene.subtitle_text,
          motion:         "static",  // default — GPT-4o motion is in Convex scenes table
        })),
      }

      const pythonUrl = process.env.NEXT_PUBLIC_RENDER_API_URL ?? "http://localhost:8000"
      const pythonRes = await fetch(`${pythonUrl}/projects/${renderResult.pythonProjectId}/render`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ scene_map: sceneMap }),
      })

      if (!pythonRes.ok) {
        const err = await pythonRes.json().catch(() => ({}))
        throw new Error((err as any).detail ?? `Render start failed: ${pythonRes.statusText}`)
      }

      setUploadProgress(100)
      toast.success("Render started!", {
        id:          signalToastId,
        description: "Render job created successfully.",
      })

      setUploadStatus("done")

      // Build UploadedFile[] for parent (render step uses previews)
      const uploadedFiles: UploadedFile[] = matchedSlots.map((slot, i) => ({
        id:         `${Date.now()}-${i}`,
        name:       slot.file!.name,
        size:       slot.file!.size,
        type:       slot.file!.type,
        status:     "ready" as const,
        file:       slot.file!,
        preview:    slot.preview ?? undefined,
        sceneIndex: slot.scene.scene_index,
      }))

      onDone(uploadedFiles)

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong"
      toast.error("Upload failed", { id: uploadToastId, description: msg })
      setUploadStatus("error")
      setUploadProgress(0)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300 px-1">

      {/* Drop zone */}
      {!hasAny && (
        <Card className="flex flex-col flex-1 min-h-0">
          <CardContent className="flex flex-col flex-1 min-h-0 pt-6">
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => folderInputRef.current?.click()}
              className={cn(
                "flex flex-col flex-1 min-h-0 items-center justify-center gap-5 rounded-lg border-2 border-dashed transition-colors cursor-pointer",
                isDragActive
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/20 bg-muted/20 hover:bg-muted/40 hover:border-muted-foreground/40",
              )}
            >
              <div className="flex flex-col items-center gap-3 pointer-events-none select-none text-center">
                <div className={cn(
                  "flex h-16 w-16 items-center justify-center rounded-2xl transition-colors",
                  isDragActive ? "bg-primary/10" : "bg-muted",
                )}>
                  <FolderOpen className={cn("h-8 w-8 transition-colors", isDragActive ? "text-primary" : "text-muted-foreground")} />
                </div>
                <div className="space-y-1.5">
                  <p className="font-semibold text-sm">
                    Drop your images here or <span className="text-primary">browse</span>
                  </p>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    Images matched by filename. Expected:{" "}
                    <span className="font-mono">001.png</span>, <span className="font-mono">002.png</span>…
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {["JPEG", "PNG", "WebP", "GIF"].map((f) => (
                    <Badge key={f} variant="secondary" className="text-xs">{f}</Badge>
                  ))}
                </div>
                <div className="flex flex-wrap justify-center gap-1.5 max-w-sm">
                  {scenes.slice(0, 6).map((sc) => (
                    <span key={sc.scene_index} className="font-mono text-[10px] bg-muted border border-border/50 px-2 py-0.5 rounded">
                      {sc.image_filename}
                    </span>
                  ))}
                  {scenes.length > 6 && (
                    <span className="font-mono text-[10px] text-muted-foreground px-2 py-0.5">
                      +{scenes.length - 6} more
                    </span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Image grid */}
      {hasAny && (
        <Card className="flex flex-col flex-1 min-h-0">
          <CardHeader className="shrink-0 pb-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1.5 flex-1">
                <CardTitle className="text-sm flex items-center gap-2">
                  {matchedCount} of {totalImagesNeeded} matched
                  {canProceed && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-normal text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                      <Check className="h-3 w-3" /> All scenes covered
                    </span>
                  )}
                </CardTitle>
                <Progress value={progressPct} className="h-1.5 w-full max-w-64" />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => folderInputRef.current?.click()}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Re-pick
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={clearAll}>
                  <X className="mr-1 h-3 w-3" /> Clear
                </Button>
              </div>
            </div>
            {!canProceed && unmatchedNeeded.length > 0 && (
              <div className="flex items-start gap-2 mt-1 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Still missing:{" "}
                  {unmatchedNeeded.slice(0, 4).map((n) => (
                    <span key={n} className="font-mono">{n} </span>
                  ))}
                  {unmatchedNeeded.length > 4 && `+${unmatchedNeeded.length - 4} more`}
                </p>
              </div>
            )}
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-y-auto pb-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {slots.map((slot, idx) => (
                <SlotCard key={slot.scene.scene_index} slot={slot} index={idx} onRemove={() => removeSlot(idx)} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hidden file input */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-ignore
        webkitdirectory=""
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        onChange={(e) => processFiles(e.target.files ?? [])}
      />

      {/* Upload progress */}
      {(uploadStatus === "uploading" || uploadStatus === "signaling") && (
        <div className="shrink-0 flex flex-col gap-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{uploadStatus === "uploading" ? "Uploading images…" : "Starting render…"}</span>
            <span className="tabular-nums">{uploadProgress}%</span>
          </div>
          <Progress value={uploadProgress} className="h-1.5" />
        </div>
      )}

      {/* Footer */}
      <div className="shrink-0 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {!hasAny
            ? `${totalImagesNeeded} image${totalImagesNeeded !== 1 ? "s" : ""} needed — one per scene`
            : canProceed
              ? "All images matched. Ready to upload and render."
              : `${totalImagesNeeded - matchedCount} image${totalImagesNeeded - matchedCount !== 1 ? "s" : ""} still needed`
          }
        </p>

        <Button
          disabled={!canUpload}
          onClick={handleUploadAndRender}
          size="lg"
          className="gap-2 min-w-40"
          title={!canProceed ? "Match all scene images before uploading" : undefined}
        >
          {uploadStatus === "uploading" || uploadStatus === "signaling" ? (
            <>
              <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
              {uploadStatus === "uploading" ? "Uploading…" : "Starting…"}
            </>
          ) : uploadStatus === "error" ? (
            <><RefreshCw className="h-4 w-4" /> Retry</>
          ) : (
            <><Upload className="h-4 w-4" /> Upload & Render</>
          )}
        </Button>
      </div>

    </div>
  )
}