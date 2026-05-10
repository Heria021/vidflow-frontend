"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "../ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { Field, FieldLabel } from "../ui/field"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

export interface Anchor {
  name: string
  gender: "Male" | "Female"
  style: string
}

interface VoiceSelectorProps {
  anchors: Anchor[]
  selectedAnchor: string
  onSelect: (name: string) => void
}

export function VoiceSelector({ anchors, selectedAnchor, onSelect }: VoiceSelectorProps) {
  const [open, setOpen] = React.useState(false)

  const selected = anchors.find(a => a.name === selectedAnchor) ?? anchors[0]
  const females = anchors.filter(a => a.gender === "Female")
  const males   = anchors.filter(a => a.gender === "Male")

  return (
    <Field>
      <FieldLabel htmlFor="voice-select">Voice Character</FieldLabel>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id="voice-select"
          role="combobox"
          aria-expanded={open}
          aria-label="Select a voice"
          className="w-full justify-between"
        >
          <span className="flex items-center gap-2 truncate">
            <GenderDot gender={selected.gender} />
            <span className="truncate">{selected.name}</span>
            <span className="text-xs text-muted-foreground shrink-0">· {selected.style}</span>
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </PopoverTrigger>

        <PopoverContent align="end" className="w-[260px] p-0">
          <Command loop>
            <CommandInput placeholder="Search voices…" />
            <CommandList className="max-h-[300px]">
              <CommandEmpty>No voices found.</CommandEmpty>

              {females.length > 0 && (
                <CommandGroup heading="Female">
                  {females.map(anchor => (
                    <VoiceItem
                      key={anchor.name}
                      anchor={anchor}
                      isSelected={selected.name === anchor.name}
                      onSelect={() => { onSelect(anchor.name); setOpen(false) }}
                    />
                  ))}
                </CommandGroup>
              )}

              {males.length > 0 && (
                <CommandGroup heading="Male">
                  {males.map(anchor => (
                    <VoiceItem
                      key={anchor.name}
                      anchor={anchor}
                      isSelected={selected.name === anchor.name}
                      onSelect={() => { onSelect(anchor.name); setOpen(false) }}
                    />
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </Field>
  )
}

function GenderDot({ gender }: { gender: "Male" | "Female" }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full shrink-0",
        gender === "Female" ? "bg-pink-400" : "bg-blue-400"
      )}
    />
  )
}

interface VoiceItemProps {
  anchor: Anchor
  isSelected: boolean
  onSelect: () => void
}

function VoiceItem({ anchor, isSelected, onSelect }: VoiceItemProps) {
  return (
    <CommandItem
      value={anchor.name}
      onSelect={onSelect}
      className={cn(
        "flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        isSelected && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
      )}
    >
      <GenderDot gender={anchor.gender} />
      <span className="flex-1">{anchor.name}</span>
      <span className={cn("text-xs", isSelected ? "text-primary-foreground/70" : "text-muted-foreground")}>
        {anchor.style}
      </span>
    </CommandItem>
  )
}