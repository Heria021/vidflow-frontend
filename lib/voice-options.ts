export interface VoiceOption {
  name:  string;
  model: string;
  style: string;
}

export const VOICE_OPTIONS: VoiceOption[] = [
  { name: "Charon", model: "en-US-Chirp3-HD-Charon", style: "Deep / Narrative"       },
  { name: "Fenrir", model: "en-US-Chirp3-HD-Fenrir", style: "Strong / Authoritative" },
  { name: "Aoede",  model: "en-US-Chirp3-HD-Aoede",  style: "Warm / Friendly"        },
  { name: "Puck",   model: "en-US-Chirp3-HD-Puck",   style: "Upbeat / Energetic"     },
  { name: "Kore",   model: "en-US-Chirp3-HD-Kore",   style: "Clear / Professional"   },
  { name: "Leda",   model: "en-US-Chirp3-HD-Leda",   style: "Soft / Calm"            },
  { name: "Orus",   model: "en-US-Chirp3-HD-Orus",   style: "Warm / Conversational"  },
  { name: "Zephyr", model: "en-US-Chirp3-HD-Zephyr", style: "Bright / Energetic"     },
];
