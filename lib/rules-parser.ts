import { generateText, Output } from "ai";
import { z } from "zod";
import { getModels } from "./ai";
import { sanitizePolicy } from "./policy";
import type { Policy } from "./types";

const schema = z.object({
  monthlyBudget: z.number().describe("Total allowed per month"),
  autoApproveLimit: z.number().describe("Purchases at or below this go through without asking"),
  hardLimit: z.number().describe("Purchases above this are always blocked"),
  allowedCategories: z.array(z.string()).describe("Lowercase category words, e.g. grocery, household, book. Empty = any category"),
  blockedKeywords: z.array(z.string()).describe("Lowercase words for things that must never be bought"),
  maxPurchasesPerDay: z.number().int(),
  summary: z.string().describe("One sentence restating the rules in plain English"),
});

/**
 * Turn plain-English rules ("$100 a month, groceries only, ask me over $20,
 * never alcohol") into a structured policy. The AI only *drafts* the policy;
 * the user reviews it, and the deterministic engine enforces it.
 */
export async function parseRules(text: string, current: Policy): Promise<{ policy: Policy; summary: string }> {
  const models = getModels();
  if (!models.length) throw new Error("Add an AI API key to write rules in plain English. You can still edit the fields directly.");

  let output: z.infer<typeof schema> | undefined;
  let lastError: unknown;
  for (const picked of models) {
    try {
      ({ output } = await generateText({
        model: picked.model,
        output: Output.object({ schema }),
        system:
          `Convert the user's spending rules for their AI shopping agent into JSON. Currency is ${current.currency}. ` +
          `Keep any value the user does not mention equal to the current rules: ${JSON.stringify(current)}. ` +
          `If they say "ask me over X", set autoApproveLimit to X. If they say "never over Y", set hardLimit to Y.`,
        prompt: text,
        maxRetries: 1,
        timeout: 45_000,
      }));
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!output) throw new Error(`The AI service is busy right now. Please try again in a minute. (${lastError instanceof Error ? lastError.message : String(lastError)})`);

  return { policy: sanitizePolicy({ ...output, currency: current.currency, paused: current.paused }, current), summary: output.summary };
}
