"use client"


import { Slider } from "@/components/ui/slider"
import { Field, FieldGroup, FieldLabel } from "../ui/field"

interface SliderFieldProps {
  id: string
  label: string
  display: string
  min: number
  max: number
  step: number
  value: number
  onValueChange: (v: number) => void
}

function SliderField({ id, label, display, min, max, step, value, onValueChange }: SliderFieldProps) {
  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <span className="w-16 rounded-md border border-transparent px-2 py-0.5 text-right text-sm text-muted-foreground hover:border-border tabular-nums">
          {display}
        </span>
      </div>
      <Slider
        id={id}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(values) => onValueChange((values as number[])[0])}
        aria-label={label}
      />
    </Field>
  )
}

interface AudioControlsProps {
  rate: number
  onRate: (v: number) => void
  pitch: number
  onPitch: (v: number) => void
  volume: number
  onVolume: (v: number) => void
}

export function AudioControls({ rate, onRate, pitch, onPitch, volume, onVolume }: AudioControlsProps) {
  // Default values if props are undefined
  const safeRate = rate ?? 1
  const safePitch = pitch ?? 0
  const safeVolume = volume ?? 0

  return (
    <FieldGroup>
      <SliderField
        id="speaking-rate"
        label="Speaking Rate"
        display={`${safeRate.toFixed(2)}×`}
        min={0.25} max={2.0} step={0.05}
        value={safeRate} onValueChange={onRate}
      />
      <SliderField
        id="pitch"
        label="Pitch"
        display={`${safePitch >= 0 ? "+" : ""}${safePitch.toFixed(1)}`}
        min={-20} max={20} step={0.5}
        value={safePitch} onValueChange={onPitch}
      />
      <SliderField
        id="volume-gain"
        label="Volume Gain"
        display={`${safeVolume >= 0 ? "+" : ""}${safeVolume.toFixed(0)} dB`}
        min={-96} max={16} step={1}
        value={safeVolume} onValueChange={onVolume}
      />
    </FieldGroup>
  )
}