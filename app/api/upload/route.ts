import { NextResponse } from "next/server"
import * as fs from "fs/promises"
import * as path from "path"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const projectId = formData.get("projectId") as string

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 })
    }

    const files = formData.getAll("files") as File[]
    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 })
    }

    const projectImagesDir = path.join(process.cwd(), "media", projectId, "images")
    await fs.mkdir(projectImagesDir, { recursive: true })

    const savedFiles = []

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer())
      // Strip any subfolder path from the original file name (e.g. "folder/001.png" → "001.png")
      const safeFilename = path.basename(file.name)
      const filepath = path.join(projectImagesDir, safeFilename)
      await fs.writeFile(filepath, buffer)
      savedFiles.push({ filename: safeFilename, path: filepath })
    }

    return NextResponse.json({
      success: true,
      message: `Successfully uploaded ${files.length} files locally`,
      localImageFolder: projectImagesDir,
      files: savedFiles,
    })
  } catch (error) {
    console.error("[Upload API] Error processing local upload:", error)
    return NextResponse.json({ error: "Failed to upload files locally" }, { status: 500 })
  }
}
