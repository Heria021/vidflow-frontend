"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAction, useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

import { useChannelContext } from "@/providers/ChannelContext"
import { AudioEncoding } from "@/types/playground"
import { generateAudioWorkflow, generateSceneMapWorkflow } from "@/lib/workflow/create-project"

import { Badge } from "@/components/ui/badge"
import { StepBar } from "@/components/playground/steps/step-bar"
import { ConfigureStep } from "@/components/playground/steps/configure-step"
import { ReviewStep } from "@/components/playground/steps/review-step"
import { UploadStep, UploadedFile } from "@/components/playground/steps/upload-step"
import { RenderStep } from "@/components/playground/steps/render-step"
import { toast } from "sonner"

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  language: "en-US",
  anchor:   "Charon",
  encoding: "MP3" as AudioEncoding,
  rate:     1,
  pitch:    0,
  volume:   0,
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type ProjectStatus =
  | "draft" | "audio_pending" | "audio_ready"
  | "scene_map_pending" | "scene_map_ready"
  | "pending_images" | "rendering" | "done" | "error"

interface Scene {
  scene_index:    number
  image_filename: string
  subtitle_text:  string
  start_time:     number
  end_time:       number
  duration:       number
  image_prompt:   string
  motion:         string
}

interface TimestampWord {
  word:  string
  start: number
  end:   number
}

interface PlaygroundState {
  projectId:  string
  project: {
    id:           string
    title:        string
    status:       string
    total_images: number
  }
  scenes:     Scene[]
  timestamps: TimestampWord[] | null
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function stepFromStatus(status: ProjectStatus): number {
  switch (status) {
    case "pending_images":
      return 3
    case "rendering":
    case "done":
    case "error":
      return 4
    case "audio_ready":
    case "scene_map_pending":
    case "scene_map_ready":
      return 2
    default:
      return 1
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function PlaygroundPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const context      = useChannelContext()

  const existingProjectId = (searchParams.get("projectId") as Id<"projects"> | null) || null
  const stepParam         = searchParams.get("step")

  // ── Convex mutations / actions ──────────────────────────────────────────
  const createProjectMut  = useMutation(api.projects.createProject)
  const setAudioPending   = useMutation(api.projects.setAudioPending)
  const saveAudioResult   = useAction(api.action.saveAudioResult)
  const saveAudioError    = useAction(api.action.saveAudioError)
  const insertSceneMap    = useAction(api.action.insertSceneMap)
  const saveSceneMapError = useAction(api.action.saveSceneMapError)

  // ── Convex query — skip when no projectId ───────────────────────────────
  const getProject = useQuery(
    api.projects.getProject,
    existingProjectId ? { projectId: existingProjectId } : "skip",
  )

  // ── Form state ──────────────────────────────────────────────────────────
  const [title,    setTitle]    = React.useState("")
  const [text,     setText]     = React.useState("")
  const [language, setLanguage] = React.useState(DEFAULTS.language)
  const [anchor,   setAnchor]   = React.useState(DEFAULTS.anchor)
  const [encoding, setEncoding] = React.useState<AudioEncoding>(DEFAULTS.encoding)
  const [rate,     setRate]     = React.useState(DEFAULTS.rate)
  const [pitch,    setPitch]    = React.useState(DEFAULTS.pitch)
  const [volume,   setVolume]   = React.useState(DEFAULTS.volume)

  // ── UI state ────────────────────────────────────────────────────────────
  const [step,           setStep]           = React.useState(1)
  const [status,         setStatus]         = React.useState<"idle" | "loading" | "error">("idle")
  const [errorMsg,       setErrorMsg]       = React.useState("")
  const [playgroundState, setPlaygroundState] = React.useState<PlaygroundState | null>(null)
  const [uploadedFiles,  setUploadedFiles]  = React.useState<UploadedFile[]>([])

  // Track whether we've hydrated from the DB so the effect only runs once
  // per projectId — not on every Convex reactive update.
  const hydratedForRef = React.useRef<string | null>(null)

  // ── Hydration effect ────────────────────────────────────────────────────
  // FIX: guarded by hydratedForRef so Convex reactive updates (getProject
  // re-running) don't reset user's form state mid-session.
  React.useEffect(() => {
    if (!existingProjectId || !getProject) return
    // Only hydrate once per projectId
    if (hydratedForRef.current === existingProjectId) return
    hydratedForRef.current = existingProjectId

    const proj = getProject
    if (!proj) {
      toast.error("Project not found")
      return
    }

    // Restore voice config
    setLanguage(proj.voice.languageCode ?? DEFAULTS.language)
    const voiceNameParts   = proj.voice.voiceName.split("-")
    const anchorFromDb     = voiceNameParts[voiceNameParts.length - 1] ?? DEFAULTS.anchor
    setAnchor(anchorFromDb)
    setEncoding((proj.voice.encoding ?? DEFAULTS.encoding) as AudioEncoding)
    setRate(proj.voice.speakingRate  ?? DEFAULTS.rate)
    setPitch(proj.voice.pitch        ?? DEFAULTS.pitch)
    setVolume(proj.voice.volumeGainDb ?? DEFAULTS.volume)
    setTitle(proj.title  ?? "")
    setText(proj.script ?? "")

    setPlaygroundState({
      projectId: proj._id,
      project: {
        id:           proj._id,
        title:        proj.title,
        status:       proj.status,
        total_images: proj.totalImages,
      },
      scenes:     [],
      timestamps: proj.timestamps ?? null,
    })

    const targetStep = stepParam
      ? parseInt(stepParam, 10)
      : stepFromStatus(proj.status as ProjectStatus)
    setStep(targetStep)

  // Intentionally only re-run when existingProjectId changes (new project loaded).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingProjectId, getProject])

  const voiceName = `${language}-Chirp3-HD-${anchor}`

  // ── Create handler ──────────────────────────────────────────────────────
  // FIX: all Convex actions/mutations included in deps to prevent stale closures.
  const handleCreate = React.useCallback(async () => {
    if (!title.trim()) { toast.error("Project title is required"); return }
    if (!text.trim())  { toast.error("Script text is required");   return }
    if (context.state !== "ready") { toast.error("Channel not found"); return }

    try {
      setStatus("loading")
      setErrorMsg("")

      const toastId = toast.loading("Creating project (1/2: Generating Audio)...")

      // Step 1: create project in Convex
      const projectId = await createProjectMut({
        channelId: context.channel._id,
        title:     title.trim(),
        script:    text.trim(),
      })

      // Step 2: mark audio as pending
      await setAudioPending({ projectId })

      // Step 3: call Google TTS (server action)
      const audioResult = await generateAudioWorkflow({
        id:           projectId,
        script:       text.trim(),
        voiceName,
        languageCode: language,
        speakingRate: rate,
        pitch,
        volumeGainDb: volume,
        encoding,
      })

      if (!audioResult.success || !audioResult.audioPath || audioResult.audioDurationSecs === undefined) {
        await saveAudioError({ projectId, errorMessage: audioResult.error ?? "Audio generation failed" })
        throw new Error(audioResult.error ?? "Audio generation failed")
      }

      // Step 4: save audio result to Convex
      await saveAudioResult({
        projectId,
        audioUrl:          audioResult.audioPath,
        audioDurationSecs: audioResult.audioDurationSecs,
        timestamps:        audioResult.timestamps ?? undefined,
      })

      toast.loading("Creating project (2/2: Generating Scenes)...", { id: toastId })

      // Step 5: call GPT-4o (server action)
      const sceneResult = await generateSceneMapWorkflow({
        id:         projectId,
        title:      title.trim(),
        script:     text.trim(),
        timestamps: audioResult.timestamps ?? null,
      })

      if (!sceneResult.success || !sceneResult.scenes) {
        await saveSceneMapError({ projectId, errorMessage: sceneResult.error ?? "Scene generation failed" })
        throw new Error(sceneResult.error ?? "Scene generation failed")
      }

      // Step 6: write scenes to Convex
      await insertSceneMap({
        projectId,
        scenes: sceneResult.scenes.map(s => ({
          sceneIndex:   s.sceneIndex,
          startTime:    s.startTime,
          endTime:      s.endTime,
          duration:     s.duration,
          subtitleText: s.subtitleText,
          imagePrompt:  s.imagePrompt,
          motion:       s.motion as any,
        })),
      })

      // Build local state for review step
      const mappedScenes: Scene[] = sceneResult.scenes.map(s => ({
        scene_index:    s.sceneIndex,
        image_filename: s.imageFilename,
        subtitle_text:  s.subtitleText,
        start_time:     s.startTime,
        end_time:       s.endTime,
        duration:       s.duration,
        image_prompt:   s.imagePrompt,
        motion:         s.motion,
      }))

      setPlaygroundState({
        projectId,
        project: {
          id:           projectId,
          title:        title.trim(),
          status:       "scene_map_ready",
          total_images: mappedScenes.length,
        },
        scenes:     mappedScenes,
        timestamps: audioResult.timestamps ?? null,
      })

      // Mark this project as already hydrated so the effect won't re-run
      hydratedForRef.current = projectId

      setStep(2)
      setStatus("idle")

      toast.success("Project created", {
        id:          toastId,
        description: `${mappedScenes.length} scenes ready for review`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create project"
      setStatus("error")
      setErrorMsg(message)
      toast.error("Project creation failed", { description: message })
    }
  }, [
    title, text, language, voiceName, rate, pitch, volume, encoding, context,
    createProjectMut, setAudioPending, saveAudioResult, saveAudioError,
    insertSceneMap, saveSceneMapError,
  ])

  // ── Upload done handler ─────────────────────────────────────────────────
  const handleUploadDone = React.useCallback((files: UploadedFile[]) => {
    setUploadedFiles(files)
    setStep(4)
  }, [])

  // ── Reset handler ───────────────────────────────────────────────────────
  const handleReset = React.useCallback(() => {
    setTitle("")
    setText("")
    setLanguage(DEFAULTS.language)
    setAnchor(DEFAULTS.anchor)
    setEncoding(DEFAULTS.encoding)
    setRate(DEFAULTS.rate)
    setPitch(DEFAULTS.pitch)
    setVolume(DEFAULTS.volume)
    setStatus("idle")
    setErrorMsg("")
    setPlaygroundState(null)
    setUploadedFiles([])
    setStep(1)
    hydratedForRef.current = null
    const slug = context.state === "ready" ? context.channel.slug : ""
    router.replace(`/${slug}/playground`)
  }, [router, context])

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] overflow-hidden">
      <header className="shrink-0 border-b">
        <div className="container flex flex-col items-start justify-between gap-2 py-4 sm:flex-row sm:items-center sm:gap-4 md:h-14">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Chirp 3 HD Playground</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">
              Google Text-to-Speech · interactive voice preview
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <StepBar current={step} />
            <Badge variant="outline" className="hidden font-mono text-[10px] tracking-wider md:inline-flex">
              {voiceName}
            </Badge>
          </div>
        </div>
      </header>

      <main className="container flex min-h-0 flex-1 flex-col pt-6">
        {step === 1 && (
          <ConfigureStep
            title={title}
            text={text}
            language={language}
            anchor={anchor}
            encoding={encoding}
            rate={rate}
            pitch={pitch}
            volume={volume}
            status={status}
            errorMsg={errorMsg}
            onTitle={setTitle}
            onText={setText}
            onLanguage={setLanguage}
            onAnchor={setAnchor}
            onEncoding={setEncoding}
            onRate={setRate}
            onPitch={setPitch}
            onVolume={setVolume}
            onCreate={handleCreate}
          />
        )}

        {step === 2 && playgroundState && (
          <ReviewStep
            project={playgroundState.project}
            scenes={playgroundState.scenes}
            timestamps={playgroundState.timestamps}
            projectTitle={title || playgroundState.project.title}
            voiceName={voiceName}
            onNext={() => setStep(3)}
          />
        )}

        {step === 3 && playgroundState && (
          <UploadStep
            projectId={playgroundState.projectId}
            projectName={playgroundState.project.title}
            totalImagesNeeded={playgroundState.project.total_images}
            scenes={playgroundState.scenes}
            onDone={handleUploadDone}
          />
        )}

        {step === 4 && playgroundState && (
          <RenderStep
            projectId={playgroundState.projectId}
            projectTitle={playgroundState.project.title}
            uploadedFiles={uploadedFiles}
            onReset={handleReset}
          />
        )}
      </main>
    </div>
  )
}