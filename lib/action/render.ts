"use server"

/**
 * lib/action/render.ts
 *
 * Server actions for triggering render jobs.
 * Calls the Python backend renderer to process a project.
 */

interface StartRenderInput {
  projectId: string
}

interface StartRenderResult {
  success: boolean
  jobId?: string
  error?: string
}

/**
 * startRender
 * Kicks off a render job for a project.
 * The actual rendering happens asynchronously on the Python backend.
 *
 * Returns a job ID for polling progress.
 */
export async function startRender(
  projectId: string,
): Promise<StartRenderResult> {
  try {
    console.log("[startRender] Triggering render for project", projectId)

    // TODO: Call your Python backend render endpoint
    // Expected response: { success: true, jobId: "..." }

    // For now, return a mock response
    return {
      success: true,
      jobId: `render_${Date.now()}`,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error("[startRender] Failed:", errorMsg)
    return {
      success: false,
      error: errorMsg,
    }
  }
}
