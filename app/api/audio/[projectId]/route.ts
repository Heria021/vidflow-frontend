import { NextResponse } from "next/server"
import * as fs from "fs"
import * as path from "path"

/**
 * GET /api/audio/[projectId]
 *
 * FIX: voiceover.ts saves audio to:
 *   media/{projectId}/audio.mp3       (base = process.cwd()/media)
 *
 * The old route was looking for:
 *   media/{projectId}/audio/audio.mp3 (extra "audio/" subfolder — wrong)
 *
 * Now matches the actual save path from resolveProjectAudioPath() in voiceover.ts.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params

  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 })
  }

  const audioPath = path.join(
    process.cwd(),
    "media",
    projectId,
    "audio.mp3",   // FIX: was "audio/audio.mp3"
  )

  if (!fs.existsSync(audioPath)) {
    return NextResponse.json({ error: "Audio not found" }, { status: 404 })
  }

  const stat      = fs.statSync(audioPath)
  const fileStream = fs.createReadStream(audioPath)

  const webStream = new ReadableStream({
    start(controller) {
      fileStream.on("data",  (chunk) => controller.enqueue(chunk instanceof Buffer ? chunk : Buffer.from(chunk)))
      fileStream.on("end",   () => controller.close())
      fileStream.on("error", (err) => controller.error(err))
    },
    cancel() {
      fileStream.destroy()
    },
  })

  return new Response(webStream, {
    headers: {
      "Content-Type":   "audio/mpeg",
      "Content-Length": String(stat.size),
      "Accept-Ranges":  "bytes",
      "Cache-Control":  "no-cache",
    },
  })
}