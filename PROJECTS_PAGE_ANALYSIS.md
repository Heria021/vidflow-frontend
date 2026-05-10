# Projects Listing Page - Codebase Analysis

## Data Models (from convex/schema.ts)

### Projects Table
- **Key Fields:**
  - `channelId`: belongs to a channel
  - `title`, `script`, `description`: content
  - `status`: ProjectStatus enum (draft, audio_pending, audio_ready, scene_map_pending, scene_map_ready, pending_images, rendering, done, error)
  - `voice`, `render`: config snapshots (copied from channel at creation)
  - `audioUrl`, `outputUrl`: stored in Convex file storage
  - `totalImages`, `imagesConfirmed`: progress tracking
  - `errorStage`, `errorMessage`: error tracking
  - `timestamps`: word-level array from TTS
  - `createdAt`, `updatedAt`, `deletedAt`: soft deletion
  
### Scenes Table
- `projectId`, `sceneIndex`, `uploadOrder`, `imageFilename`
- `imageStorageId`, `imageUrl`, `imageReady`
- `subtitleText`, `imagePrompt`, `motion`: content
- `generation`: version tracking (only max generation is "active")
- Used for scene management and render tracking

### Render Jobs Table
- `projectId`, `status` (queued, rendering, done, error, cancelled)
- `progress` (0-100)
- `renderConfig` snapshot
- `outputStorageId`, `outputUrl`, `fileSizeBytes`, `durationSecs`
- `errorMessage`, `errorStage`
- `startedAt`, `finishedAt`, `renderTimeSecs`
- `createdAt`, `updatedAt`

## Convex Queries Available

### From projects.ts:
- `listProjects(channelId)` - ALL non-deleted projects, newest first (lightweight)
- `getProject(projectId)` - Full project doc
- `getProjectStatus(projectId)` - Lightweight reactive query: { status, errorStage, errorMessage, totalImages, imagesConfirmed }
- `hasAnyProject(channelId)` - Boolean check

### From renderJob.ts:
- `getLatestRenderJob(projectId)` - Latest render job doc
- `listRenderJobs(projectId)` - All render jobs for project, newest first

### From scenes.ts:
- `listScenes(projectId)` - All scenes for project
- `getSceneProgress(projectId)` - Progress metrics

## Existing UI Patterns

### Components:
- **Card**: Flexible container with header/content/footer slots
- **Badge**: Status indicators with variants (default, secondary, destructive, outline, ghost)
- **Empty**: Empty state container with EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyActions
- **Spinner**: Loading indicator
- **Button**: Action triggers
- **Progress**: Visual progress bar

### Layout:
- **DashboardShell**: Main page wrapper (from app/[slug]/layout.tsx)
- **AppSidebar**: Navigation with NavProjects section
- Responsive grid layouts (md:grid-cols-3, etc.)

### Context:
- **ChannelProvider**: Makes channel data available via `useChannelContext()`
- Pattern: loads once in layout.tsx, data available to all children

### Styling:
- Tailwind CSS with custom slot-based data attributes
- Rounded corners: rounded-xl (11px)
- Borders: border, border-border/X opacity
- Colors: primary, secondary, destructive, muted, foreground, card
- Spacing: gap-4, px-4, py-4, etc.

## Status Badge Mapping

From schema, ProjectStatus values:
- `draft`: In progress, editable (secondary or outline badge)
- `audio_pending`: Processing (spinner or animated badge)
- `audio_ready`: Ready for scenes (blue/primary)
- `scene_map_pending`: Processing scenes (spinner)
- `scene_map_ready`: Scenes ready (blue/primary)
- `pending_images`: Waiting for images (orange/secondary)
- `rendering`: Rendering (animated)
- `done`: Complete (green/success)
- `error`: Failed (destructive/red)

## Image Progress Display

Projects track:
- `totalImages`: Expected count
- `imagesConfirmed`: Uploaded count
- Calculation: `(imagesConfirmed / totalImages) * 100` for progress bar

## Existing Architecture Patterns

1. **Data Fetching**: useQuery from Convex react library
2. **State Management**: React.useState for client UI state
3. **Mutations**: useMutation for mutations
4. **Conditional Rendering**: Ternary operators for loading/error/success states
5. **Responsive**: Mobile-first with md: breakpoints
6. **Empty States**: Always provide empty state component

## What NOT to Do

- ❌ Don't mock data - use real Convex queries
- ❌ Don't hardcode status labels - map from enum
- ❌ Don't create new UI pattern types - reuse existing components
- ❌ Don't fetch projects inside cards - fetch once at page level
- ❌ Don't ignore loading states
- ❌ Don't ignore pagination (handle large project lists later)

## Key Implementation Notes

1. **listProjects query returns lightweight docs** - suitable for listing
2. **Each card can use getLatestRenderJob** - separate query, will cause individual updates
3. **Status enum is the source of truth** - map all UI to enum values
4. **Images confirmed/total drives progress bar** - no additional query needed
5. **Channel context provides channelId** - use via useChannelContext()
6. **Soft deletion via deletedAt** - listProjects already filters these out
7. **Newest first ordering** - projects are pre-sorted by convex query

## Layout Structure

```
app/[slug]/projects/
├── layout.tsx (static wrapper)
└── page.tsx (main listing component)

components/projects/
├── project-card.tsx (reusable card component)
├── projects-grid.tsx (grid wrapper)
├── status-badge.tsx (status display helper)
└── empty-projects.tsx (empty state)
```

## Component Hierarchy

```
ProjectsPage
├── useQuery(listProjects) - fetch all projects
├── useChannelContext() - get channelId
├── [Loading state with skeleton cards]
├── [Error state with alert]
├── [Empty state if no projects]
└── ProjectsGrid
    └── ProjectCard[] (for each project)
        ├── Status badge
        ├── Image progress bar
        ├── Created date
        └── Render job status
```
