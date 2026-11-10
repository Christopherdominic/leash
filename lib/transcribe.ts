import { generateText } from "ai";
import { getModels } from "./ai";

const PROMPT = `Transcribe this voice message. The speaker is telling an AI shopping assistant what to buy, or describing spending rules.
Speakers may have any accent (for example Nigerian, Indian or British English); transcribe the words they mean.
Expect product names and shopping words like: paper towels, dish soap, laundry detergent pods, toothpaste, shampoo, air fryer, rice cooker, blender, printer paper, notebook, book, headphones, red wine, gift card, budget, per month, approve, groceries, household, kitchen.
Write prices as numbers (e.g. "$25"). Reply with only the transcribed words, no quotes or notes. If nothing is said, reply with nothing.`;

/** Turn a short voice clip into text, trying each model in turn if one is busy. */
export async function transcribe(audio: Uint8Array, mediaType: string): Promise<string> {
  const models = getModels({ accurate: true });
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
