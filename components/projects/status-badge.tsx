"use client"

import { Badge } from "@/components/ui/badge"
import { Loader2 } from "lucide-react"

type ProjectStatus = 
  | "draft"
  | "audio_pending"
  | "audio_ready"
  | "scene_map_pending"
  | "scene_map_ready"
  | "pending_images"
  | "rendering"
  | "done"
  | "error"

interface StatusBadgeProps {
  status: ProjectStatus
}

/**
 * StatusBadge
 * Maps project status to visual badge with appropriate styling and icons
 */
export function StatusBadge({ status }: StatusBadgeProps) {
  // Status configurations
  const statusConfig: Record<ProjectStatus, {
    label: string
    variant: "default" | "secondary" | "destructive" | "outline"
    showSpinner?: boolean
  }> = {
    draft: { label: "Draft", variant: "outline" },
    audio_pending: { label: "Generating Audio", variant: "default", showSpinner: true },
    audio_ready: { label: "Audio Ready", variant: "default" },
    scene_map_pending: { label: "Analyzing Scenes", variant: "default", showSpinner: true },
    scene_map_ready: { label: "Scenes Ready", variant: "default" },
    pending_images: { label: "Awaiting Images", variant: "secondary" },
    rendering: { label: "Rendering", variant: "default", showSpinner: true },
    done: { label: "Complete", variant: "default" },
    error: { label: "Failed", variant: "destructive" },
  }

  const config = statusConfig[status]

  return (
    <Badge variant={config.variant} className="inline-flex gap-1">
      {config.showSpinner && (
        <Loader2 className="h-3 w-3 animate-spin" />
      )}
      <span>{config.label}</span>
    </Badge>
  )
}
