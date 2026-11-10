import type { LanguageModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";

/**
 * Pick the model from env. Any one key is enough:
 *   GOOGLE_GENERATIVE_AI_API_KEY (free tier at aistudio.google.com), or
 *   OPENAI_API_KEY, or ANTHROPIC_API_KEY.
 * Override the model name with AI_MODEL if a default is retired.
 */
export type PickedModel = { model: LanguageModel; label: string };

export function getModel(): PickedModel | null {
  return getModels()[0] ?? null;
}

/**
 * Fast, light model first, then bigger backups to try when one is overloaded or slow.
 * Backups only apply to Google and only when AI_MODEL is not set.
 */
export function getModels(): PickedModel[] {
  const provider = (process.env.AI_PROVIDER ?? "").toLowerCase();
  if ((provider === "google" || !provider) && process.env.GOOGLE_GENERATIVE_AI_API_KEY && !process.env.AI_MODEL) {
    const google = createGoogleGenerativeAI();
    return ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"].map((n) => ({ model: google(n), label: `Google ${n}` }));
  }
  const one = pickOne();
  return one ? [one] : [];
}

function pickOne(): PickedModel | null {
  const provider = (process.env.AI_PROVIDER ?? "").toLowerCase();
  const m = process.env.AI_MODEL;

  if ((provider === "google" || !provider) && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const name = m ?? "gemini-3.8-flash";
    return { model: createGoogleGenerativeAI()(name), label: `Google ${name}` };
  }
  if ((provider === "openai" || !provider) && process.env.OPENAI_API_KEY) {
    const name = m ?? "gpt-4.1-mini";
    return { model: createOpenAI()(name), label: `OpenAI ${name}` };
  }
  if ((provider === "anthropic" || !provider) && process.env.ANTHROPIC_API_KEY) {
    const name = m ?? "claude-haiku-4-5";
    return { model: createAnthropic()(name), label: `Anthropic ${name}` };
  }
  return null;
}
