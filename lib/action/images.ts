"use server"

/**
 * lib/action/images.ts
 *
 * Server actions for playground image uploads.
 * Handles file upload to Convex storage and registration.
 */

interface UploadImageBatchInput {
  projectId: string
  files: File[]
}

interface UploadImageBatchResult {
  success: boolean
  uploaded: string[]
  error?: string
}

/**
 * uploadImageBatch
 * Uploads image files for a project to Convex storage.
 * 
 * Returns the filenames of uploaded files.
 * The actual scene registration happens in the component via Convex mutations.
 */
export async function uploadImageBatch(
  projectId: string,
  files: File[],
): Promise<UploadImageBatchResult> {
  try {
    console.log("[uploadImageBatch] Processing", files.length, "files for project", projectId)

    // Upload files using multipart form to /api/upload endpoint
    // This endpoint should:
    // 1. Call Convex generateUploadUrl() to get signed URLs
    // 2. Upload files directly to Convex storage
    // 3. Return storageIds and URLs
    
    const formData = new FormData()
    formData.append("projectId", projectId)
    files.forEach((file, idx) => {
      formData.append(`files`, file)
    })

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    })

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`)
    }

    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error ?? "Upload failed")
    }

    const uploaded = data.uploaded.map((item: any) => item.filename)
    console.log("[uploadImageBatch] Uploaded successfully:", uploaded)

    return {
      success: true,
      uploaded,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error("[uploadImageBatch] Failed:", errorMsg)
    return {
      success: false,
      uploaded: [],
      error: errorMsg,
    }
  }
}

/**
 * getImagesStatus
 * Check which images are ready on the server.
 * Used to verify upload completion before starting render.
 */
export async function getImagesStatus(projectId: string): Promise<{
  success: boolean
  missing: string[]
  error?: string
}> {
  try {
    console.log("[getImagesStatus] Checking images for project", projectId)

    // Query Convex to check scene status
    const response = await fetch(`/api/scenes/status?projectId=${projectId}`)

    if (!response.ok) {
      throw new Error(`Status check failed: ${response.statusText}`)
    }

    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error ?? "Status check failed")
    }

    const missing = data.missing ?? []
    return {
      success: true,
      missing,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error("[getImagesStatus] Failed:", errorMsg)
    return {
      success: false,
      missing: [],
      error: errorMsg,
    }
  }
}
