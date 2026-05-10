"use client"

import * as React from "react"
import { ArrowRight, Clock, Film, Mic2, Layers, Copy, Check } from "lucide-react"
import { Button }  from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast }   from "sonner"
import { ScenesTable } from "../scene-table"

// ── Types ─────────────────────────────────────────────────────────

interface Scene {
  scene_index:    number
  image_filename: string
  start_time:     number
  end_time:       number
  duration:       number
  subtitle_text:  string
  motion:         string
  image_prompt:   string
}

interface TimestampWord {
  word:  string
  start: number
  end:   number
}

interface ReviewStepProps {
  project: {
    id: string
    title: string
    status: string
    total_images: number
  }
  scenes: Scene[]
  projectTitle: string
  voiceName: string
  timestamps?: TimestampWord[] | null
  onNext: () => void
}

// ── Copy button ───────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false)
  async function handleCopy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    toast.success(label ? `${label} copied` : "Copied")
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-muted/60 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
    >
      {copied
        ? <Check className="h-3 w-3 text-emerald-500" />
        : <Copy  className="h-3 w-3" />}
    </button>
  )
}

// ── Stat pill ─────────────────────────────────────────────────────

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-muted/40 border border-border/40 h-full">
      <span className="text-muted-foreground/60">{icon}</span>
      <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider leading-none">{label}</span>
      <span className="text-sm font-semibold tabular-nums leading-none">{value}</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────

export function ReviewStep({ project, scenes, projectTitle, voiceName, timestamps, onNext }: ReviewStepProps) {
  const totalDuration = scenes.reduce((sum, s) => sum + s.duration, 0)
  // ── FIX: correct audio API URL ────────────────────────────────
  const audioUrl = `/api/audio/${project.id}`

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300 px-1">

      {/* ── Top strip: identity + stats ───────────────────────── */}
      <div className="shrink-0 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

        <div className="flex flex-col gap-1 min-w-0">
          <h2 className="text-base font-semibold truncate">{projectTitle}</h2>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-mono text-muted-foreground/60">{project.id}</span>
            <CopyButton value={project.id} label="Project ID" />
          </div>
        </div>

        <div className="flex gap-2 shrink-0 flex-wrap">
          <Stat icon={<Film   className="h-3.5 w-3.5" />} label="Scenes"   value={String(scenes.length)} />
          <Stat icon={<Layers className="h-3.5 w-3.5" />} label="Images"   value={String(project.total_images)} />
          <Stat icon={<Clock  className="h-3.5 w-3.5" />} label="Duration" value={`${totalDuration.toFixed(1)}s`} />
        </div>
      </div>

      {/* ── Audio preview ──────────────────────────────────────── */}
      <Card className="shrink-0 border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Mic2 className="h-3.5 w-3.5" /> Audio Preview
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-muted-foreground/60 truncate">{voiceName}</span>
            <span className="text-[11px] text-muted-foreground/60 tabular-nums">
              {totalDuration.toFixed(2)}s total
            </span>
          </div>
          <audio
            controls
            src={audioUrl}
            className="w-full h-8"
            style={{ accentColor: "hsl(var(--primary))" }}
            onError={(e) => {
              const el = e.currentTarget
              console.warn("[ReviewStep] Audio failed to load:", el.src)
            }}
          />
        </CardContent>
      </Card>

      {/* ── Scenes + Timestamps sheet ──────────────────────────── */}
      <ScenesTable scenes={scenes} timestamps={timestamps} />

      {/* ── Action ────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Review the scenes above, then upload one image per scene.
        </p>
        <Button onClick={onNext} size="lg" className="gap-2">
          Upload Images
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

    </div>
  )
}