"use client"

import * as React from "react"
import { Slider } from "@/components/ui/slider"

// ─── Types ────────────────────────────────────────────────────────────────────

export type AudioEncoding = "MP3" | "LINEAR16" | "OGG_OPUS"

export interface Language {
  label: string
  value: string
}

export interface Anchor {
  name: string
  gender: "Male" | "Female"
  style: string
}

export interface AudioConfigValue {
  language: string
  anchor: string
  encoding: AudioEncoding
  rate: number
  pitch: number
  volume: number
}

interface AudioConfigProps {
  value: AudioConfigValue
  onChange: (value: AudioConfigValue) => void
  className?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const LANGUAGES: Language[] = [
  { label: "English (US)", value: "en-US" },
  { label: "Hindi (India)", value: "hi-IN" },
]

export const ANCHORS: Anchor[] = [
  { name: "Aoede", gender: "Female", style: "Professional" },
  { name: "Kore", gender: "Female", style: "Calm / Soft" },
  { name: "Leda", gender: "Female", style: "Engaging" },
  { name: "Zephyr", gender: "Female", style: "Light" },
  { name: "Charon", gender: "Male", style: "Deep / Narrative" },
  { name: "Puck", gender: "Male", style: "Energetic" },
  { name: "Fenrir", gender: "Male", style: "Bold" },
  { name: "Orus", gender: "Male", style: "Steady" },
]

const ENCODINGS: { id: AudioEncoding; label: string; desc: string }[] = [
  { id: "MP3", label: "MP3", desc: "MPEG Layer 3 — compressed, widely compatible, smallest file size." },
  { id: "LINEAR16", label: "WAV", desc: "16-bit PCM WAV — uncompressed, lossless, largest file size." },
  { id: "OGG_OPUS", label: "OGG", desc: "Ogg Opus — efficient lossy compression, great for streaming." },
]

// ─── Primitives (no external shadcn deps) ────────────────────────────────────

function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(" ")
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={cn("h-3 w-3 shrink-0 opacity-50 transition-transform duration-150", open && "rotate-180")}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="2,4 6,8 10,4" />
    </svg>
  )
}

function CheckIcon({ visible }: { visible: boolean }) {
  return (
    <svg
      className={cn("h-3 w-3 shrink-0 transition-opacity", visible ? "opacity-100" : "opacity-0")}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="1.5,6.5 4.5,9.5 10.5,2.5" />
    </svg>
  )
}

function GenderDot({ gender }: { gender: "Male" | "Female" }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        gender === "Female" ? "bg-pink-400" : "bg-blue-400"
      )}
    />
  )
}

// ─── Dropdown (replaces Popover + Command) ────────────────────────────────────

interface DropdownOption {
  label?: string
  value?: string
  name?: string
  gender?: "Male" | "Female"
  style?: string
}

interface DropdownGroup {
  label: string
  filter: (o: DropdownOption) => boolean
}

interface DropdownProps {
  options: DropdownOption[]
  searchPlaceholder?: string
  groups?: DropdownGroup[]
  renderSelected: (current: DropdownOption) => React.ReactNode
  renderOption: (
    option: DropdownOption,
    select: () => void,
    current: DropdownOption
  ) => React.ReactNode
  current: DropdownOption
  onChange: (option: DropdownOption) => void
}

function Dropdown({
  options,
  searchPlaceholder = "Search…",
  groups,
  renderSelected,
  renderOption,
  current,
  onChange,
}: DropdownProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const q = query.toLowerCase()
  const filtered = q
    ? options.filter(o => (o.label ?? o.name ?? "").toLowerCase().includes(q))
    : options

  const groupedFiltered = groups
    ? groups.map(g => ({ ...g, items: filtered.filter(g.filter) })).filter(g => g.items.length > 0)
    : null

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setQuery("") }}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input",
          "bg-transparent px-3 py-2 text-sm shadow-sm",
          "focus:outline-none focus:ring-1 focus:ring-ring",
          open && "ring-1 ring-ring"
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {renderSelected(current)}
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded-md border border-input bg-popover shadow-md">
          {/* Search */}
          <div className="border-b border-input p-2">
            <input
              autoFocus
              placeholder={searchPlaceholder}
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* List */}
          <div className="max-h-[220px] overflow-y-auto">
            {groupedFiltered ? (
              groupedFiltered.length === 0 ? (
                <p className="py-3 text-center text-xs text-muted-foreground">No results.</p>
              ) : (
                groupedFiltered.map(g => (
                  <div key={g.label}>
                    <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {g.label}
                    </p>
                    {g.items.map(o =>
                      renderOption(o, () => { onChange(o); setOpen(false); setQuery("") }, current)
                    )}
                  </div>
                ))
              )
            ) : filtered.length === 0 ? (
              <p className="py-3 text-center text-xs text-muted-foreground">No results.</p>
            ) : (
              filtered.map(o =>
                renderOption(o, () => { onChange(o); setOpen(false); setQuery("") }, current)
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}



// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AudioConfig({ value, onChange, className }: AudioConfigProps) {
  // Provide defaults for any undefined values
  const safeValue: AudioConfigValue = {
    language: value.language ?? "en-US",
    anchor: value.anchor ?? "Charon",
    encoding: value.encoding ?? "MP3",
    rate: value.rate ?? 1.0,
    pitch: value.pitch ?? 0.0,
    volume: value.volume ?? 0.0,
  }

  const set = <K extends keyof AudioConfigValue>(key: K, val: AudioConfigValue[K]) =>
    onChange({ ...safeValue, [key]: val })

  const currentLang = LANGUAGES.find(l => l.value === safeValue.language) ?? LANGUAGES[0]
  const currentAnchor = ANCHORS.find(a => a.name === safeValue.anchor) ?? ANCHORS[0]
  const currentEnc = ENCODINGS.find(e => e.id === safeValue.encoding) ?? ENCODINGS[0]

  const femaleAnchors = ANCHORS.filter(a => a.gender === "Female")
  const maleAnchors = ANCHORS.filter(a => a.gender === "Male")

  return (
    <div
      className={cn(
        "flex flex-col divide-y divide-border rounded-xl border bg-card text-card-foreground overflow-y-auto h-full",
        className
      )}
    >
      {/* ── Voice ── */}
      <div className="space-y-4 p-5">
        <SectionLabel>Voice</SectionLabel>

        {/* Language */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Language</label>
          <Dropdown
            current={currentLang}
            options={LANGUAGES}
            searchPlaceholder="Search languages…"
            renderSelected={v => <span className="truncate">{(v as Language).label}</span>}
            renderOption={(o, select, cur) => {
              const lang = o as Language
              const selected = (cur as Language).value === lang.value
              return (
                <div
                  key={lang.value}
                  onClick={select}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground",
                    selected && "font-medium"
                  )}
                >
                  <span className="flex-1">{lang.label}</span>
                  <span className="mr-1 font-mono text-[10px] text-muted-foreground">{lang.value}</span>
                  <CheckIcon visible={selected} />
                </div>
              )
            }}
            onChange={o => set("language", (o as Language).value)}
          />
        </div>

        {/* Voice Character */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Voice Character</label>
          <Dropdown
            current={currentAnchor}
            options={ANCHORS}
            searchPlaceholder="Search voices…"
            groups={[
              { label: "Female", filter: a => (a as Anchor).gender === "Female" },
              { label: "Male", filter: a => (a as Anchor).gender === "Male" },
            ]}
            renderSelected={v => {
              const a = v as Anchor
              return (
                <>
                  <GenderDot gender={a.gender} />
                  <span className="truncate">{a.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">· {a.style}</span>
                </>
              )
            }}
            renderOption={(o, select, cur) => {
              const anchor = o as Anchor
              const selected = (cur as Anchor).name === anchor.name
              return (
                <div
                  key={anchor.name}
                  onClick={select}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground",
                    selected && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                  )}
                >
                  <GenderDot gender={anchor.gender} />
                  <span className="flex-1">{anchor.name}</span>
                  <span className={cn("text-xs", selected ? "text-primary-foreground/70" : "text-muted-foreground")}>
                    {anchor.style}
                  </span>
                </div>
              )
            }}
            onChange={o => set("anchor", (o as Anchor).name)}
          />
        </div>
      </div>

      {/* ── Encoding ── */}
      <div className="space-y-3 p-5">
        <SectionLabel>Output Encoding</SectionLabel>

        <div className="flex gap-1.5">
          {ENCODINGS.map(enc => (
            <button
              key={enc.id}
              type="button"
              onClick={() => set("encoding", enc.id)}
              className={cn(
                "flex-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors",
                safeValue.encoding === enc.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-transparent text-muted-foreground hover:border-foreground hover:text-foreground"
              )}
            >
              {enc.label}
            </button>
          ))}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">{currentEnc.desc}</p>
      </div>

      {/* ── Audio Controls ── */}
      <div className="space-y-5 p-5">
        <SectionLabel>Audio Controls</SectionLabel>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Speaking Rate</label>
            <span className="min-w-[64px] text-right text-sm tabular-nums text-muted-foreground">
              {safeValue.rate.toFixed(2)}×
            </span>
          </div>
          <Slider
            value={[safeValue.rate]}
            onValueChange={(v: number | readonly number[]) => {
              const val = Array.isArray(v) ? v[0] : v
              set("rate", val)
            }}
            min={0.25}
            max={2.0}
            step={0.05}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Pitch</label>
            <span className="min-w-[64px] text-right text-sm tabular-nums text-muted-foreground">
              {safeValue.pitch >= 0 ? "+" : ""}{safeValue.pitch.toFixed(1)}
            </span>
          </div>
          <Slider
            value={[safeValue.pitch]}
            onValueChange={(v: number | readonly number[]) => {
              const val = Array.isArray(v) ? v[0] : v
              set("pitch", val)
            }}
            min={-20}
            max={20}
            step={0.5}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Volume Gain</label>
            <span className="min-w-[64px] text-right text-sm tabular-nums text-muted-foreground">
              {safeValue.volume >= 0 ? "+" : ""}{safeValue.volume.toFixed(0)} dB
            </span>
          </div>
          <Slider
            value={[safeValue.volume]}
            onValueChange={(v: number | readonly number[]) => {
              const val = Array.isArray(v) ? v[0] : v
              set("volume", val)
            }}
            min={-96}
            max={16}
            step={1}
          />
        </div>
      </div>
    </div>
  )
}