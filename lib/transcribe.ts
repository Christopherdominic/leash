import { generateText } from "ai";
import { getModels } from "./ai";

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
              { type: "text", text: "Transcribe this voice message exactly as spoken. Reply with only the words said, no quotes or notes. If nothing is said, reply with nothing." },
              { type: "file", data: audio, mediaType },
            ],
          },
        ],
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
