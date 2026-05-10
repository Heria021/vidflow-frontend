"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "../ui/button"
import { Field, FieldLabel } from "../ui/field"
import {
  Command, CommandEmpty, CommandGroup,
  CommandInput, CommandItem, CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"


export interface Language {
  label: string
  value: string
}

interface LanguageSelectorProps {
  languages: Language[]
  selected: string
  onSelect: (value: string) => void
}

export function LanguageSelector({ languages, selected, onSelect }: LanguageSelectorProps) {
  const [open, setOpen] = React.useState(false)
  const current = languages.find(l => l.value === selected) ?? languages[0]

  return (
    <Field>
      <FieldLabel htmlFor="language-select">Language</FieldLabel>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger 
          id="language-select"
          role="combobox"
          aria-expanded={open}
          aria-label="Select a language"
          className="w-full justify-between"
        >
          {current.label}
          <ChevronsUpDown className="ml-2 opacity-50 size-4 shrink-0" />
        </PopoverTrigger>

        <PopoverContent className="w-[240px] p-0">
          <Command>
            <CommandInput placeholder="Search languages…" />
            <CommandList>
              <CommandEmpty>No languages found.</CommandEmpty>
              <CommandGroup heading="Supported">
                {languages.map(lang => (
                  <CommandItem
                    key={lang.value}
                    value={lang.value}
                    onSelect={() => { onSelect(lang.value); setOpen(false) }}
                  >
                    <span className="flex-1">{lang.label}</span>
                    <span className="text-xs text-muted-foreground mr-2 font-mono">{lang.value}</span>
                    <Check className={cn("size-4 shrink-0", selected === lang.value ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </Field>
  )
}
