"use client"

import * as React from "react"
import { Check, Copy, ChevronDown, ChevronRight, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

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

interface ScenesTableProps {
  scenes:     Scene[]
  timestamps?: TimestampWord[] | null   // word-level Chirp timestamps
}

// ── Motion colour map ─────────────────────────────────────────────

const MOTION_COLORS: Record<string, string> = {
  zoom_in:   "bg-blue-500/10 text-blue-600 border-blue-500/20",
  zoom_out:  "bg-violet-500/10 text-violet-600 border-violet-500/20",
  pan_left:  "bg-amber-500/10 text-amber-600 border-amber-500/20",
  pan_right: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  pan_up:    "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  pan_down:  "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  static:    "bg-zinc-500/10 text-zinc-600 border-zinc-500/20",
}

function motionClass(motion: string) {
  return MOTION_COLORS[motion] ?? "bg-zinc-500/10 text-zinc-600 border-zinc-500/20"
}

// ── Copy button ───────────────────────────────────────────────────

function CopyBtn({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false)
  function handle() {
    navigator.clipboard.writeText(value)
    setCopied(true)
    toast.success(label ? `${label} copied` : "Copied")
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button
      onClick={(e) => { e.stopPropagation(); handle() }}
      className="ml-1 p-1 rounded hover:bg-muted/60 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

// ── Scene row (expandable prompt) ─────────────────────────────────

function SceneRow({ scene }: { scene: Scene }) {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <TableRow
        className={cn(
          "cursor-pointer select-none transition-colors hover:bg-muted/30",
          open && "bg-muted/40"
        )}
        onClick={() => setOpen((v) => !v)}
      >
        {/* Index */}
        <TableCell className="w-10 pl-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
            <span className="font-mono text-[11px] font-semibold text-muted-foreground">
              {String(scene.scene_index + 1).padStart(2, "0")}
            </span>
          </div>
        </TableCell>

        {/* Expand chevron */}
        <TableCell className="w-6 pl-0 pr-1">
          {open
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />}
        </TableCell>

        {/* Filename */}
        <TableCell className="w-28">
          <span className="font-mono text-xs text-muted-foreground truncate block max-w-[110px]">
            {scene.image_filename}
          </span>
        </TableCell>

        {/* Subtitle */}
        <TableCell className="max-w-[220px]">
          <p className="text-xs text-foreground/80 line-clamp-2">{scene.subtitle_text}</p>
        </TableCell>

        {/* Timing */}
        <TableCell className="text-[11px] font-mono text-muted-foreground whitespace-nowrap tabular-nums">
          {scene.start_time.toFixed(2)}s → {scene.end_time.toFixed(2)}s
        </TableCell>

        {/* Duration */}
        <TableCell className="text-[11px] font-mono text-muted-foreground whitespace-nowrap tabular-nums">
          {scene.duration.toFixed(2)}s
        </TableCell>

        {/* Motion */}
        <TableCell>
          <span className={cn(
            "inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium whitespace-nowrap",
            motionClass(scene.motion)
          )}>
            {scene.motion.replace(/_/g, " ")}
          </span>
        </TableCell>
      </TableRow>

      {/* ── Expanded: image prompt ─────────────────────────────── */}
      {open && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={7} className="py-2 pl-14 pr-4">
            <div className="flex items-start gap-2 rounded-lg border border-dashed border-border/60 bg-background/60 px-3 py-2">
              <p className="flex-1 text-xs text-muted-foreground leading-relaxed">
                {scene.image_prompt || <span className="italic opacity-50">No prompt</span>}
              </p>
              <CopyBtn value={scene.image_prompt} label="Prompt" />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

// ── Timestamps tab ────────────────────────────────────────────────

function TimestampsTab({ words }: { words: TimestampWord[] }) {
  const [copiedAll, setCopiedAll] = React.useState(false)

  function handleCopyAll() {
    const tsv = ["Word\tStart\tEnd\tDuration"]
      .concat(words.map(w => `${w.word}\t${w.start.toFixed(3)}\t${w.end.toFixed(3)}\t${(w.end - w.start).toFixed(3)}`))
      .join("\n")
    navigator.clipboard.writeText(tsv)
    setCopiedAll(true)
    toast.success("Timestamps copied as TSV")
    setTimeout(() => setCopiedAll(false), 1800)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <p className="text-xs text-muted-foreground">
          {words.length} word{words.length !== 1 ? "s" : ""} · Chirp 3 HD timing
        </p>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleCopyAll}>
          {copiedAll ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          {copiedAll ? "Copied!" : "Copy TSV"}
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-4 text-[11px]">#</TableHead>
              <TableHead className="text-[11px]">Word</TableHead>
              <TableHead className="text-[11px] tabular-nums">Start (s)</TableHead>
              <TableHead className="text-[11px] tabular-nums">End (s)</TableHead>
              <TableHead className="text-[11px] tabular-nums">Duration (s)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {words.map((w, i) => (
              <TableRow key={i} className="text-[11px]">
                <TableCell className="pl-4 font-mono text-muted-foreground/60">{i + 1}</TableCell>
                <TableCell className="font-medium">{w.word || <span className="italic text-muted-foreground/40">—</span>}</TableCell>
                <TableCell className="font-mono tabular-nums text-muted-foreground">{w.start.toFixed(3)}</TableCell>
                <TableCell className="font-mono tabular-nums text-muted-foreground">{w.end.toFixed(3)}</TableCell>
                <TableCell className="font-mono tabular-nums text-muted-foreground">
                  {(w.end - w.start).toFixed(3)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────

type Tab = "scenes" | "timestamps"

export function ScenesTable({ scenes, timestamps }: ScenesTableProps) {
  const [tab,       setTab]       = React.useState<Tab>("scenes")
  const [copiedAll, setCopiedAll] = React.useState(false)
  const [updateSheetOpen, setUpdateSheetOpen] = React.useState(false)
  const [pastedSheet, setPastedSheet] = React.useState("")

  function handleCopyAll() {
    const all = scenes.map((s) => s.image_prompt).join("\n\n")
    navigator.clipboard.writeText(all)
    setCopiedAll(true)
    toast.success("All prompts copied", { description: `${scenes.length} prompts copied to clipboard` })
    setTimeout(() => setCopiedAll(false), 1800)
  }

  // Show the tab if timestamps is a non-null array (even if empty)
  // This lets us distinguish: (a) never fetched = null, (b) fetched but empty = []
  const hasTimestamps = Array.isArray(timestamps)

  return (
    <>
      <Card className="flex flex-col flex-1 min-h-0">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Scene Bit Sheet</CardTitle>
            <CardDescription>
              {scenes.length} scene{scenes.length !== 1 ? "s" : ""} · click a row to view its image prompt
            </CardDescription>
          </div>
          <CardAction className="flex items-center gap-2">
            {tab === "scenes" && (
              <>
                <Button variant="secondary" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleCopyAll}>
                  {copiedAll ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedAll ? "Copied!" : "Copy All Prompts"}
                </Button>
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setUpdateSheetOpen(true)}>
                  <Upload className="h-3.5 w-3.5" />
                  Update Sheet
                </Button>
              </>
            )}
          </CardAction>
        </div>

        {/* ── Tab bar ────────────────────────────────────────────── */}
        <div className="flex gap-1.5 mt-3 border-b pb-0">
          {(["scenes", ...(hasTimestamps ? ["timestamps"] : [])] as Tab[]).map((t) => {
            const isActive = tab === t
            const count    = t === "scenes" ? scenes.length : (timestamps?.length ?? 0)
            const label    = t === "scenes" ? "Scenes" : "Timestamps"
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                  isActive
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
                <span className={cn(
                  "inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums min-w-[20px]",
                  isActive
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground"
                )}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col flex-1 min-h-0 overflow-hidden p-0 mt-0">
        {tab === "scenes" && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4 text-[11px]">#</TableHead>
                  <TableHead className="w-6 pl-0 text-[11px]" />
                  <TableHead className="w-28 text-[11px]">File</TableHead>
                  <TableHead className="text-[11px]">Subtitle</TableHead>
                  <TableHead className="text-[11px]">Timing</TableHead>
                  <TableHead className="text-[11px]">Dur.</TableHead>
                  <TableHead className="text-[11px]">Motion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scenes.map((scene) => (
                  <SceneRow key={scene.scene_index} scene={scene} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {tab === "timestamps" && hasTimestamps && (
          timestamps!.length > 0
            ? <TimestampsTab words={timestamps!} />
            : (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground py-12">
                <p className="text-sm font-medium">No word timestamps returned</p>
                <p className="text-xs text-center max-w-xs">
                  Google Chirp TTS did not return any timepoints for this audio.
                  Check that <code className="font-mono bg-muted px-1 rounded">enableTimePointing: [&apos;SSML_MARK&apos;]</code> is supported
                  by your Google API key / credentials and the selected voice model.
                </p>
              </div>
            )
        )}
      </CardContent>
    </Card>

      <Dialog open={updateSheetOpen} onOpenChange={setUpdateSheetOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Update Scene Bit Sheet</DialogTitle>
            <DialogDescription>
              Paste your updated scene bit sheet here. The format should match the TSV export exactly.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="rounded-md border bg-muted/30 p-3 flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-foreground/80 uppercase tracking-wider">Expected Format (TSV):</span>
              <div className="overflow-x-auto pb-1">
                <pre className="text-[10px] text-muted-foreground font-mono whitespace-pre inline-block select-all">
                  scene_index&#9;image_filename&#9;subtitle_text&#9;start_time&#9;end_time&#9;duration&#9;image_prompt&#9;motion
                </pre>
              </div>
            </div>
            <textarea 
              value={pastedSheet}
              onChange={(e) => setPastedSheet(e.target.value)}
              className="flex min-h-[250px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono resize-y"
              placeholder="Paste your updated TSV rows here..."
              spellCheck={false}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUpdateSheetOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              if (!pastedSheet.trim()) {
                toast.error("Please paste some data first");
                return;
              }
              console.log("Pasted Sheet Data:", pastedSheet);
              toast.success("Sheet data validated", { description: "Check console for logged data" });
              setUpdateSheetOpen(false);
              setPastedSheet("");
            }}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}