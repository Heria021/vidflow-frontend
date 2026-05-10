"use client"

import { ProjectCard } from "./project-card"
import type { Doc } from "@/convex/_generated/dataModel"

type Project = Doc<"projects">

interface ProjectsGridProps {
  projects: Project[]
  channelSlug: string
}

/**
 * ProjectsGrid
 * Renders a responsive grid of project cards
 */
export function ProjectsGrid({ projects, channelSlug }: ProjectsGridProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {projects.map((project) => (
        <ProjectCard
          key={project._id}
          project={project}
          channelSlug={channelSlug}
        />
      ))}
    </div>
  )
}
