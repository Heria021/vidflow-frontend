"use client"

import React from "react"
import { Textarea } from "@/components/ui/textarea"
import { AudioEncoding } from "@/types/playground"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupInput } from "@/components/ui/input-group"
import { Button } from "@/components/ui/button"
import { AudioConfig, AudioConfigValue } from "../audio-config"

interface ConfigureStepProps {
  title: string
  text: string
  language: string
  anchor: string
  encoding: AudioEncoding
  rate: number
  pitch: number
  volume: number
  status: "idle" | "loading" | "error"
  errorMsg?: string
  onTitle: (v: string) => void
  onText: (v: string) => void
  onLanguage: (v: string) => void
  onAnchor: (v: string) => void
  onEncoding: (v: AudioEncoding) => void
  onRate: (v: number) => void
  onPitch: (v: number) => void
  onVolume: (v: number) => void
  onCreate: () => void
}

export function ConfigureStep({
  title, text, language, anchor, encoding, rate, pitch, volume,
  status, errorMsg,
  onTitle, onText, onLanguage, onAnchor, onEncoding, onRate, onPitch, onVolume,
  onCreate,
}: ConfigureStepProps) {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length
  const canCreate = title.trim().length > 0 && text.trim().length > 0

  const config: AudioConfigValue = { language, anchor, encoding, rate, pitch, volume }

  function handleConfigChange(next: AudioConfigValue) {
    if (next.language !== language) onLanguage(next.language)
    if (next.anchor !== anchor) onAnchor(next.anchor)
    if (next.encoding !== encoding) onEncoding(next.encoding)
    if (next.rate !== rate) onRate(next.rate)
    if (next.pitch !== pitch) onPitch(next.pitch)
    if (next.volume !== volume) onVolume(next.volume)
  }

  return (
    <div className="grid flex-1 min-h-0 items-stretch gap-6 md:grid-cols-[1fr_280px] px-1">

      {/* RIGHT — config sidebar */}
      <div className="hidden flex-col sm:flex md:order-2 min-h-0 h-full">
        <AudioConfig value={config} onChange={handleConfigChange} />
      </div>

      {/* LEFT — editor, fills height and stacks vertically */}
      <div className="flex flex-col min-h-0 gap-4 md:order-1">

        <FieldGroup className="flex flex-col flex-1 min-h-0 gap-4">

          {/* Title field — fixed height */}
          <Field className="shrink-0">
            <FieldLabel htmlFor="pg-title">Video / Project Title</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="pg-title"
                value={title}
                onChange={e => onTitle(e.target.value)}
                placeholder="e.g. Ancient Mysteries of Egypt"
              />
            </InputGroup>
          </Field>

          {/* Script field — grows to fill remaining space */}
          <Field className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between shrink-0">
              <FieldLabel htmlFor="pg-script">Narration Script</FieldLabel>
              <span className="text-xs text-muted-foreground tabular-nums">
                {wordCount} words
              </span>
            </div>
            <Textarea
              id="pg-script"
              value={text}
              onChange={e => onText(e.target.value)}
              placeholder="Type or paste your narration script here…"
              className="flex-1 min-h-0 resize-none p-4 text-sm leading-relaxed"
            />
          </Field>

        </FieldGroup>

        {status === "error" && errorMsg && (
          <p className="shrink-0 text-xs text-destructive px-1">{errorMsg}</p>
        )}

        <Button
          onClick={onCreate}
          disabled={!canCreate || status === "loading"}
          size="lg"
          className="shrink-0 py-2 text-sm font-semibold"
        >
          {status === "loading" ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
              Creating Project…
            </span>
          ) : "Create Project"}
        </Button>

      </div>
    </div>
  )
}