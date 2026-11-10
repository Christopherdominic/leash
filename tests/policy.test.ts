import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, blockedTermsIn, categoryMatches, evaluate, evaluateForApprovedPurchase, sanitizePolicy, spendSnapshot } from "../lib/policy";
import type { Product, Purchase } from "../lib/types";

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  title: "Oat Milk",
  categories: ["grocery"],
  price: 5,
  currency: "USD",
  ...over,
});
const none = { spentThisMonth: 0, purchasesToday: 0 };

describe("rules engine", () => {
  it("allows small purchases in an allowed category", () => {
    expect(evaluate(DEFAULT_POLICY, product(), none).outcome).toBe("ALLOW");
  });

  it("asks for approval above the auto-approve limit", () => {
    const d = evaluate(DEFAULT_POLICY, product({ price: 89.99, categories: ["home", "kitchen"] }), none);
    expect(d.outcome).toBe("NEEDS_APPROVAL");
  });

  it("blocks above the hard limit even in an allowed category", () => {
    expect(evaluate(DEFAULT_POLICY, product({ price: 500 }), none).outcome).toBe("BLOCK");
  });

  it("blocks disallowed categories", () => {
    const d = evaluate(DEFAULT_POLICY, product({ categories: ["electronics"], price: 10 }), none);
    expect(d.outcome).toBe("BLOCK");
    expect(d.reasons.join(" ")).toMatch(/not in your allowed list/);
  });

  it("blocks keywords even when the category is allowed (wine in grocery)", () => {
    const d = evaluate(DEFAULT_POLICY, product({ title: "Red Wine 750ml", categories: ["grocery", "wine"] }), none);
    expect(d.outcome).toBe("BLOCK");
  });

  it("blocks when the monthly budget would be exceeded", () => {
    const d = evaluate(DEFAULT_POLICY, product({ price: 20 }), { spentThisMonth: 140, purchasesToday: 0 });
    expect(d.outcome).toBe("BLOCK");
  });

  it("enforces the daily purchase limit", () => {
    expect(evaluate(DEFAULT_POLICY, product(), { spentThisMonth: 0, purchasesToday: 5 }).outcome).toBe("BLOCK");
  });

  it("kill switch blocks everything", () => {
    expect(evaluate({ ...DEFAULT_POLICY, paused: true }, product(), none).outcome).toBe("BLOCK");
  });

  it("blocks currency mismatches", () => {
    expect(evaluate(DEFAULT_POLICY, product({ currency: "EUR" }), none).outcome).toBe("BLOCK");
  });

  it("human approval converts ASK into ALLOW but never overrides a BLOCK", () => {
    const big = product({ price: 89.99, categories: ["kitchen appliances"] });
    expect(evaluateForApprovedPurchase(DEFAULT_POLICY, big, none).outcome).toBe("ALLOW");
    expect(evaluateForApprovedPurchase({ ...DEFAULT_POLICY, paused: true }, big, none).outcome).toBe("BLOCK");
  });

  it("counts only this month's live purchases", () => {
    const now = new Date("2026-11-08T12:00:00Z");
    const mk = (amount: number, createdAt: string, status: Purchase["status"] = "COMPLETED"): Purchase => ({
      id: Math.random().toString(),
      productId: "x",
      title: "x",
      amount,
      currency: "USD",
      status,
      approvedBy: "policy",
      createdAt,
    });
    const snap = spendSnapshot(
      [mk(10, "2026-11-08T10:00:00Z"), mk(5, "2026-11-01T10:00:00Z"), mk(99, "2026-10-30T10:00:00Z"), mk(7, "2026-11-08T09:00:00Z", "REFUNDED")],
      now,
    );
    expect(snap).toEqual({ spentThisMonth: 15, purchasesToday: 1 });
  });

  it("sanitizes bad input", () => {
    const p = sanitizePolicy({ monthlyBudget: -5, autoApproveLimit: 999, hardLimit: 50, allowedCategories: ["  book ", ""] });
    expect(p.monthlyBudget).toBe(DEFAULT_POLICY.monthlyBudget);
    expect(p.autoApproveLimit).toBe(50);
    expect(p.allowedCategories).toEqual(["book"]);
  });
});

describe("categoryMatches", () => {
  it("matches whole words and plurals only", () => {
    expect(categoryMatches("print books", "book")).toBe(true);
    expect(categoryMatches("kitchen & dining", "kitchen")).toBe(true);
    expect(categoryMatches("household supplies", "household")).toBe(true);
    expect(categoryMatches("home & garden", "home")).toBe(true);
    expect(categoryMatches("party supplies", "art")).toBe(false);
    expect(categoryMatches("bookends", "book")).toBe(false);
  });

  it("does not let decor in 'home & garden' through the default rules", () => {
    const decor = { id: "d", title: "Artificial Coffee Beans", categories: ["vase fillers", "home & garden", "decor"], price: 9, currency: "USD" };
    expect(evaluate(DEFAULT_POLICY, decor, { spentThisMonth: 0, purchasesToday: 0 }).outcome).toBe("BLOCK");
  });
});

describe("blockedTermsIn", () => {
  it("finds never-buy words in a request", () => {
    expect(blockedTermsIn("buy me 2 bottles of beer", DEFAULT_POLICY)).toEqual(["beer"]);
    expect(blockedTermsIn("Buy me alcohol", DEFAULT_POLICY)).toEqual(["alcohol"]);
    expect(blockedTermsIn("dish soap and red wine", DEFAULT_POLICY)).toEqual(["wine"]);
    expect(blockedTermsIn("a $50 gift card please", DEFAULT_POLICY)).toEqual(["gift card"]);
  });

  it("ignores allowed requests", () => {
    expect(blockedTermsIn("paper towels and an air fryer", DEFAULT_POLICY)).toEqual([]);
  });
});
