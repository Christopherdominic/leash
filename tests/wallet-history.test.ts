import { beforeEach, describe, expect, it } from "vitest";
import { activateWallet, archiveCurrentWallet, log, resetState, state } from "../lib/store";
import type { Purchase } from "../lib/types";

const purchase = (id: string, createdAt: string): Purchase => ({
  id, productId: id, title: id, amount: 5, currency: "USD", status: "COMPLETED", approvedBy: "policy", createdAt,
});

describe("history per PayPal account", () => {
  beforeEach(() => {
    resetState(false);
    state().archives = {};
  });

  it("disconnect hides the history; reconnecting the same account restores it", () => {
    activateWallet({ vaultId: "v1", email: "Alice@example.com" });
    state().purchases.unshift(purchase("a1", "2026-11-10T10:00:00Z"));
    log("allowed", "Paid for a1");

    expect(archiveCurrentWallet()).toBe("Alice@example.com");
    expect(state().purchases).toEqual([]);
    expect(state().activity).toEqual([]);
    expect(state().wallet).toEqual({});

    expect(activateWallet({ vaultId: "v2", email: "alice@example.com" })).toBe(1);
    expect(state().purchases.map((p) => p.id)).toEqual(["a1"]);
    expect(state().activity.map((e) => e.message)).toContain("Paid for a1");
  });

  it("a different account starts fresh and doesn't see the first one's history", () => {
    activateWallet({ vaultId: "v1", email: "alice@example.com" });
    state().purchases.unshift(purchase("a1", "2026-11-10T10:00:00Z"));
    archiveCurrentWallet();

    expect(activateWallet({ vaultId: "v3", email: "bob@example.com" })).toBe(0);
    expect(state().purchases).toEqual([]);
    expect(Object.keys(state().archives)).toEqual(["alice@example.com"]);
  });

  it("keeps newest-first order when merging history", () => {
    activateWallet({ vaultId: "v1", email: "alice@example.com" });
    state().purchases.unshift(purchase("old", "2026-11-01T10:00:00Z"));
    archiveCurrentWallet();
    state().purchases.unshift(purchase("guest", "2026-11-09T10:00:00Z"));
    activateWallet({ vaultId: "v2", email: "alice@example.com" });
    expect(state().purchases.map((p) => p.id)).toEqual(["guest", "old"]);
  });
});
