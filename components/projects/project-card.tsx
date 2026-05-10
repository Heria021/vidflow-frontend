"use client"

import * as React     from "react"
import { Button }     from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Progress }   from "@/components/ui/progress"
import { Spinner }    from "@/components/ui/spinner"
import { StatusBadge } from "./status-badge"
import { AlertCircle, Play, Download } from "lucide-react"
import type { Doc }   from "@/convex/_generated/dataModel"

type Project   = Doc<"projects">
type RenderJob = Doc<"renderJobs"> | null | undefined

interface ProjectCardProps {
  project:     Project
  channelSlug: string
  // FIX: renderJob passed as prop from the parent (projects-grid.tsx) which
  // fetches all render jobs in a single query instead of one query per card.
  // This eliminates the N+1 Convex subscription problem.
  renderJob?:  RenderJob
}

/**
 * ProjectCard
 *
 * FIX: removed useQuery(getLatestRenderJob) from inside this component.
 * With N cards that created N live Convex subscriptions all firing on load.
 * renderJob is now a prop supplied by the parent grid.
 */
export function ProjectCard({ project, channelSlug, renderJob }: ProjectCardProps) {
  const progressPercent = project.totalImages > 0
    ? (project.imagesConfirmed / project.totalImages) * 100
    : 0

  const formattedDate = new Date(project.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day:   "numeric",
    year:  "numeric",
  })

  const isRendering    = renderJob?.status === "rendering" || renderJob?.status === "queued"
  const renderFailed   = renderJob?.status === "error"
  const renderComplete = renderJob?.status === "done"
  const renderProgress = renderJob?.progress ?? 0

  return (
    <Card className="hover:ring-1 hover:ring-foreground/20 transition-all cursor-pointer h-full flex flex-col group/card">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="truncate text-base">{project.title}</CardTitle>
            {project.description && (
              <CardDescription className="truncate text-xs mt-1">
                {project.description}
              </CardDescription>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-4">
        {/* Status */}
        <div className="flex items-center gap-2">
          <StatusBadge status={project.status} />
          {renderJob && (
            <div className="text-xs text-muted-foreground">
              {renderComplete && <span>✓ Rendered</span>}
              {renderFailed && (
                <span className="flex items-center gap-1 text-destructive">
                  <AlertCircle className="h-3 w-3" /> Render failed
                </span>
              )}
              {isRendering && (
                <span className="flex items-center gap-1">
                  <Spinner /> {renderProgress}%
                </span>
              )}
            </div>
          )}
        </div>

        {/* Image progress */}
        {project.totalImages > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Images</span>
              <span className="font-medium">{project.imagesConfirmed}/{project.totalImages}</span>
            </div>
            <Progress value={progressPercent} className="h-1.5" />
          </div>
        )}

        {/* Render progress */}
        {isRendering && renderJob && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Render</span>
              <span className="font-medium">{renderProgress}%</span>
            </div>
            <Progress value={renderProgress} className="h-1.5" />
          </div>
        )}

        {/* Error message */}
        {project.status === "error" && project.errorMessage && (
          <div className="text-xs text-destructive bg-destructive/10 px-2 py-1.5 rounded border border-destructive/20">
            {project.errorMessage}
          </div>
        )}

        <div className="text-xs text-muted-foreground pt-2 border-t border-border/50">
          Created {formattedDate}
        </div>
      </CardContent>

      {/* Actions */}
      <div className="px-4 pb-4 pt-2 border-t border-border/50 flex gap-2">
        <a href={`/${channelSlug}/playground?projectId=${project._id}`} className="flex-1">
          <Button variant="outline" size="sm" className="w-full">
            <Play className="h-3 w-3" /> Open
          </Button>
        </a>
        {renderComplete && (
          // FIX: download from Python's endpoint, not a non-existent /api/video route
          <a
            href={`${process.env.NEXT_PUBLIC_RENDER_API_URL ?? "http://localhost:8000"}/projects/${renderJob?.externalJobId ?? project._id}/render/download`}
            download={`${project.title}.mp4`}
            target="_blank"
            rel="noreferrer"
            className="flex-1"
          >
            <Button variant="outline" size="sm" className="w-full">
              <Download className="h-3 w-3" /> Download
            </Button>
          </a>
        )}
      </div>
    </Card>
  )
}