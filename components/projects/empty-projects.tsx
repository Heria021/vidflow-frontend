"use client"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty"
import { VideoIcon, Plus } from "lucide-react"

interface EmptyProjectsProps {
  channelSlug: string
}

/**
 * EmptyProjects
 * Displayed when no projects exist in the channel yet
 */
export function EmptyProjects({ channelSlug }: EmptyProjectsProps) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <VideoIcon className="h-6 w-6" />
        </EmptyMedia>
        <EmptyTitle>No projects yet</EmptyTitle>
        <EmptyDescription>
          Start by creating your first video project. Design, configure, and render videos with ease.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <a href={`/${channelSlug}/playground`}>
          <Button>
            <Plus className="h-4 w-4" />
            Create Project
          </Button>
        </a>
      </EmptyContent>
    </Empty>
  )
}
