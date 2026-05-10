"use server"

/**
 * lib/workflow/start-render.ts
 *
 * Trigger the Python renderer to process a project.
 * This is a simple kickoff — the actual rendering happens
 * asynchronously on the Python backend.
 *
 * The client polls or streams SSE for progress updates.
 */

interface StartRenderInput {
  projectId: string
}

interface StartRenderResult {
  success: boolean
  error?: string
}

export async function startRender(
  input: StartRenderInput,
): Promise<StartRenderResult> {
  try {
    console.log("[startRender] Triggering render for:", input.projectId)

    // Call Python backend render endpoint
    // (Assuming there's a /api/render/{projectId} or similar)
    const response = await fetch(`/api/render/${input.projectId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error ?? `Render failed: ${response.statusText}`)
    }

    console.log("[startRender] Render triggered successfully")
    return { success: true }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error("[startRender] Failed:", errorMsg)
    return { success: false, error: errorMsg }
  }
}
