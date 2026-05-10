"use client"

import * as React from "react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useChannelContext } from "@/providers/ChannelContext"
import { ProjectsGrid } from "@/components/projects/projects-grid"
import { ProjectsGridSkeleton } from "@/components/projects/projects-skeleton"
import { EmptyProjects } from "@/components/projects/empty-projects"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * ProjectsPage
 *
 * FIX: useQuery must be called unconditionally — React hooks cannot be called
 * after early returns. We pass "skip" when the channel isn't ready so Convex
 * holds the query without executing it.
 */
export default function ProjectsPage() {
  const context = useChannelContext()

  // ── ALL hooks must be called before any conditional return ──────────────
  // Pass "skip" when channel isn't ready — Convex will not execute the query.
  const projects = useQuery(
    api.projects.listProjects,
    context.state === "ready" ? { channelId: context.channel._id } : "skip",
  )

  // ── Loading state ────────────────────────────────────────────────────────
  if (context.state === "loading" || (context.state === "ready" && projects === undefined)) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <ProjectsGridSkeleton />
      </div>
    )
  }

  // ── Channel not found ────────────────────────────────────────────────────
  if (context.state === "not_found") {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Channel not found. Please select a valid channel.
        </AlertDescription>
      </Alert>
    )
  }

  const { channel } = context
  const channelSlug = channel.slug

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!projects || projects.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader count={0} channelName={channel.name} channelSlug={channelSlug} />
        <EmptyProjects channelSlug={channelSlug} />
      </div>
    )
  }

  // ── Render projects ──────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        count={projects.length}
        channelName={channel.name}
        channelSlug={channelSlug}
      />
      <ProjectsGrid projects={projects} channelSlug={channelSlug} />
    </div>
  )
}

// ── Extracted header to avoid repetition ────────────────────────────────────

function PageHeader({
  count,
  channelName,
  channelSlug,
}: {
  count?: number
  channelName?: string
  channelSlug?: string
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
        <p className="text-muted-foreground mt-1">
          {count !== undefined && channelName
            ? `${count} project${count !== 1 ? "s" : ""} in ${channelName}`
            : "Manage and view all your video projects"}
        </p>
      </div>
      {channelSlug && (
        <a href={`/${channelSlug}/playground`}>
          <Button>
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </a>
      )}
    </div>
  )
}