import { generateText } from "ai";
import { getModels } from "./ai";

const PROMPT = `Transcribe this audio word for word, exactly as spoken, in the language spoken. The speaker may have any accent, such as Nigerian English.
Do not guess, correct, or add words that were not said. If a word is unclear, write your best phonetic guess.
Reply with only the transcript, no quotes or notes. If there is no speech, reply with nothing.`;

/** Turn a short voice clip into text, trying each model in turn if one is busy. */
export async function transcribe(audio: Uint8Array, mediaType: string): Promise<string> {
  const models = getModels();
  if (!models.length) throw new Error("Add an AI API key to use voice input.");
  let lastError: unknown;
  for (const picked of models) {
    try {
      const { text } = await generateText({
        model: picked.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "file", data: audio, mediaType },
            ],
          },
        ],
        temperature: 0,
        // Transcription doesn't need the model to "think" first; skipping it is much faster.
        providerOptions: { google: { thinkingConfig: { thinkingLevel: picked.label.includes("3.5") ? "minimal" : "low" } } },
        maxRetries: 1,
        timeout: 30_000,
      });
      return text.trim();
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`Couldn't transcribe right now. Please try again. (${lastError instanceof Error ? lastError.message : String(lastError)})`);
}
