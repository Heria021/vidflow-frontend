"use client"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * ProjectsGridSkeleton
 * Loading state skeleton for projects grid
 */
export function ProjectsGridSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Card key={i} className="h-full flex flex-col">
          <CardHeader>
            <div className="space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </CardHeader>

          <CardContent className="flex-1 flex flex-col gap-4">
            <Skeleton className="h-6 w-24" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-2 w-full" />
            </div>
            <div className="text-xs space-y-1">
              <Skeleton className="h-3 w-1/3" />
            </div>
          </CardContent>

          <div className="px-4 pb-4 pt-2 border-t border-border/50 flex gap-2">
            <Skeleton className="h-7 flex-1" />
            <Skeleton className="h-7 flex-1" />
          </div>
        </Card>
      ))}
    </div>
  )
}
