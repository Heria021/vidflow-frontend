"use server"

/**
 * lib/workflow/create-project.ts
 *
 * Client-callable server actions for the playground project creation workflow.
 * Split into two granular steps to allow the client to update Convex status.
 */

import { synthesizeVoiceover } from "@/lib/services/voiceover"
import { generateSceneMap } from "@/lib/services/sceneMap"
import type { WordTimestamp } from "@/lib/services/voiceover"
import type { SceneMapItem } from "@/lib/services/sceneMap"

export interface GenerateAudioInput {
  id: string
  script: string
  voiceName: string
  languageCode: string
  speakingRate: number
  pitch: number
  volumeGainDb: number
  encoding: "MP3" | "LINEAR16" | "OGG_OPUS"
}

export interface GenerateAudioResult {
  success: boolean
  error?: string
  audioPath?: string
  audioDurationSecs?: number
  timestamps?: WordTimestamp[] | null
}

export async function generateAudioWorkflow(
  input: GenerateAudioInput,
): Promise<GenerateAudioResult> {
  try {
    console.log("[generateAudioWorkflow] Generating audio for:", input.id)
    const voiceoverResult = await synthesizeVoiceover(
      input.script,
      {
        voiceName: input.voiceName,
        languageCode: input.languageCode,
        speakingRate: input.speakingRate,
        pitch: input.pitch,
        volumeGainDb: input.volumeGainDb,
        encoding: input.encoding,
      },
      input.id, // projectId for file path
    )

    console.log(
      "[generateAudioWorkflow] Audio ready:",
      voiceoverResult.audioDurationSecs.toFixed(2),
      "sec",
    )

    return {
      success: true,
      audioPath: voiceoverResult.audioPath,
      audioDurationSecs: voiceoverResult.audioDurationSecs,
      timestamps: voiceoverResult.timestamps,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error("[generateAudioWorkflow] Failed:", errorMsg)
    return { success: false, error: errorMsg }
  }
}

export interface GenerateScenesInput {
  id: string
  title: string
  script: string
  timestamps: WordTimestamp[] | null
}

export interface Scene {
  sceneIndex: number
  imageFilename: string
  subtitleText: string
  startTime: number
  endTime: number
  duration: number
  imagePrompt: string
  motion: string
}

export interface GenerateScenesResult {
  success: boolean
  error?: string
  scenes?: Scene[]
}

export async function generateSceneMapWorkflow(
  input: GenerateScenesInput,
): Promise<GenerateScenesResult> {
  try {
    console.log("[generateSceneMapWorkflow] Generating scenes for:", input.id)
    const sceneMapResult = await generateSceneMap(
      input.title,
      input.script,
      input.timestamps ?? [],
    )

    console.log(
      "[generateSceneMapWorkflow] Scenes ready:",
      sceneMapResult.scenes.length,
      "scenes",
    )

    const scenes: Scene[] = sceneMapResult.scenes.map((item: SceneMapItem) => ({
      sceneIndex: item.sceneIndex,
      imageFilename: item.imageFilename,
      subtitleText: item.subtitleText,
      startTime: item.startTime,
      endTime: item.endTime,
      duration: item.duration,
      imagePrompt: item.imagePrompt,
      motion: item.motion,
    }))

    return { success: true, scenes }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error("[generateSceneMapWorkflow] Failed:", errorMsg)
    return { success: false, error: errorMsg }
  }
}
