"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Field, FieldLabel } from "../ui/field"
import { AudioEncoding } from "@/types/playground"

const ENCODING_DESCRIPTIONS: Record<AudioEncoding, string> = {
  MP3: "MPEG Layer 3 — compressed, widely compatible, smallest file size.",
  LINEAR16: "16-bit PCM WAV — uncompressed, lossless, largest file size.",
  OGG_OPUS: "Ogg Opus — efficient lossy compression, great for streaming.",
}

const ENCODINGS: AudioEncoding[] = ["MP3", "LINEAR16", "OGG_OPUS"]

interface EncodingSelectorProps {
  value: AudioEncoding
  onValueChange: (enc: AudioEncoding) => void
}

export function EncodingSelector({ value, onValueChange }: EncodingSelectorProps) {
  return (
    <Field>
      <FieldLabel htmlFor="encoding-select">Output Encoding</FieldLabel>

      <ToggleGroup
        value={[value] as any}
        onValueChange={(val) => {
          const encodingVal = Array.isArray(val) ? val[0] : val
          if (encodingVal && typeof encodingVal === 'string') onValueChange(encodingVal as AudioEncoding)
        }}
        variant="outline"
        className="flex gap-1.5"
      >
        {ENCODINGS.map(enc => (
          <ToggleGroupItem key={enc} value={enc}>
            {enc === "LINEAR16" ? "WAV" : enc}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <p className="text-xs text-muted-foreground leading-relaxed">
        {ENCODING_DESCRIPTIONS[value]}
      </p>
    </Field>
  )
}