import type { Decision, Policy, Product, Purchase } from "./types";

/**
 * The Leash rules engine.
 *
 * This is plain, deterministic code: the AI agent never decides whether a
 * purchase is allowed. It can only *ask*. Price and category come from the
 * product catalog, not from the model, so a confused or prompt-injected agent
 * cannot talk its way past the rules.
 */

export const DEFAULT_POLICY: Policy = {
  currency: "USD",
  monthlyBudget: 150,
  autoApproveLimit: 25,
  hardLimit: 120,
  allowedCategories: ["grocery", "food", "household", "kitchen", "book", "office", "personal care", "health"],
  blockedKeywords: ["alcohol", "wine", "beer", "vodka", "gift card", "tobacco", "vape", "crypto", "lottery"],
  maxPurchasesPerDay: 5,
  paused: false,
};

export type SpendSnapshot = {
  spentThisMonth: number;
  purchasesToday: number;
};

export function spendSnapshot(purchases: Purchase[], now = new Date()): SpendSnapshot {
  const live = purchases.filter((p) => p.status === "COMPLETED" || p.status === "PENDING_PAYER");
  const month = now.toISOString().slice(0, 7);
  const day = now.toISOString().slice(0, 10);
  return {
    spentThisMonth: round2(live.filter((p) => p.createdAt.startsWith(month)).reduce((s, p) => s + p.amount, 0)),
    purchasesToday: live.filter((p) => p.createdAt.startsWith(day)).length,
  };
}

export function evaluate(policy: Policy, product: Product, spend: SpendSnapshot): Decision {
  const block: string[] = [];
  const ask: string[] = [];
  const money = (n: number) => `${policy.currency} ${n.toFixed(2)}`;

  if (policy.paused) block.push("Agent spending is paused (kill switch is on).");

  if (product.currency.toUpperCase() !== policy.currency.toUpperCase()) {
    block.push(`Price is in ${product.currency}, but your wallet is set to ${policy.currency}.`);
  }

  if (!(product.price > 0)) block.push("Product has no valid price.");

  const haystack = [product.title, product.brand ?? "", ...product.categories].join(" ").toLowerCase();
  const hit = policy.blockedKeywords.find((k) => k.trim() && haystack.includes(k.trim().toLowerCase()));
  if (hit) block.push(`Matches a blocked item: "${hit}".`);

  if (policy.allowedCategories.length > 0) {
    const ok = policy.allowedCategories.some((c) => c.trim() && product.categories.some((cat) => categoryMatches(cat, c)));
    if (!ok) {
      block.push(
        `Category "${product.categories[0] ?? "unknown"}" is not in your allowed list (${policy.allowedCategories.join(", ")}).`,
      );
    }
  }

  if (product.price > policy.hardLimit) {
    block.push(`${money(product.price)} is over your hard limit of ${money(policy.hardLimit)} per purchase.`);
  }

  const remaining = round2(policy.monthlyBudget - spend.spentThisMonth);
  if (product.price > remaining) {
    block.push(`Not enough budget left this month: ${money(remaining)} remaining.`);
  }

  if (spend.purchasesToday >= policy.maxPurchasesPerDay) {
    block.push(`Daily limit reached: ${policy.maxPurchasesPerDay} purchases per day.`);
  }

  if (block.length) return { outcome: "BLOCK", reasons: block };

  if (product.price > policy.autoApproveLimit) {
    ask.push(`${money(product.price)} is above your auto-approve limit of ${money(policy.autoApproveLimit)}.`);
  }
  if (ask.length) return { outcome: "NEEDS_APPROVAL", reasons: ask };

  return {
    outcome: "ALLOW",
    reasons: [`Within limits. ${money(round2(remaining - product.price))} left this month after this purchase.`],
  };
}

/**
 * Whole-word match, so "book" matches "print books" but "home" doesn't sneak in
 * through "home & garden" decor or "art" through "party supplies".
 */
export function categoryMatches(category: string, allowed: string): boolean {
  const term = allowed.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${term}(s|es)?($|[^a-z])`).test(category.toLowerCase());
}

/** Checks a human-approved purchase again at execution time (budget may have changed). */
export function evaluateForApprovedPurchase(policy: Policy, product: Product, spend: SpendSnapshot): Decision {
  const d = evaluate(policy, product, spend);
  return d.outcome === "NEEDS_APPROVAL" ? { outcome: "ALLOW", reasons: ["Approved by you."] } : d;
}

export function sanitizePolicy(input: Partial<Policy>, base: Policy = DEFAULT_POLICY): Policy {
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);
  const list = (v: unknown, fallback: string[]) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : fallback;
  const p: Policy = {
    currency: typeof input.currency === "string" && /^[A-Za-z]{3}$/.test(input.currency) ? input.currency.toUpperCase() : base.currency,
    monthlyBudget: num(input.monthlyBudget, base.monthlyBudget),
    autoApproveLimit: num(input.autoApproveLimit, base.autoApproveLimit),
    hardLimit: num(input.hardLimit, base.hardLimit),
    allowedCategories: list(input.allowedCategories, base.allowedCategories),
    blockedKeywords: list(input.blockedKeywords, base.blockedKeywords),
    maxPurchasesPerDay: Math.floor(num(input.maxPurchasesPerDay, base.maxPurchasesPerDay)),
    paused: typeof input.paused === "boolean" ? input.paused : base.paused,
  };
  if (p.autoApproveLimit > p.hardLimit) p.autoApproveLimit = p.hardLimit;
  return p;
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}
