import { evaluate, evaluateForApprovedPurchase, spendSnapshot } from "./policy";
import { chargeVaultedWallet, createApprovalOrder, refundCapture } from "./paypal";
import { notifyPhone } from "./notify";
import { log, newId, state } from "./store";
import type { Approval, Decision, Product, Purchase } from "./types";

export type PurchaseAttempt =
  | { outcome: "PURCHASED"; purchase: Purchase; decision: Decision }
  | { outcome: "PENDING_PAYER"; purchase: Purchase; decision: Decision }
  | { outcome: "NEEDS_APPROVAL"; approval: Approval; decision: Decision }
  | { outcome: "BLOCKED"; decision: Decision }
  | { outcome: "FAILED"; error: string; decision: Decision };

/**
 * The only path from the agent to money. The agent passes a product id; the
 * price and category are read from the server-side cache filled by catalog
 * search, never from the model's arguments.
 */
export async function requestPurchase(productId: string, appUrl: string): Promise<PurchaseAttempt | { outcome: "UNKNOWN_PRODUCT" }> {
  const s = state();
  const product = s.productCache.get(productId);
  if (!product) return { outcome: "UNKNOWN_PRODUCT" };

  const decision = evaluate(s.policy, product, spendSnapshot(s.purchases));

  if (decision.outcome === "BLOCK") {
    log("blocked", `Blocked "${product.title}" (${fmt(product)}): ${decision.reasons.join(" ")}`);
    return { outcome: "BLOCKED", decision };
  }

  if (decision.outcome === "NEEDS_APPROVAL") {
    const existing = s.approvals.find((a) => a.status === "PENDING" && a.product.id === product.id);
    const approval: Approval = existing ?? {
      id: newId("apr"),
      product,
      reasons: decision.reasons,
      status: "PENDING",
      createdAt: new Date().toISOString(),
    };
    if (!existing) {
      s.approvals.unshift(approval);
      log("approval", `Asked you to approve "${product.title}" (${fmt(product)}): ${decision.reasons.join(" ")}`);
      void notifyPhone(`Leash: approve ${fmt(product)}?`, `${product.title}\n${decision.reasons.join(" ")}`, appUrl);
    }
    return { outcome: "NEEDS_APPROVAL", approval, decision };
  }

  return execute(product, "policy", decision, appUrl);
}

export async function resolveApproval(approvalId: string, approve: boolean, appUrl: string) {
  const s = state();
  const approval = s.approvals.find((a) => a.id === approvalId);
  if (!approval) throw new Error("Approval not found");
  if (approval.status !== "PENDING") throw new Error(`Approval already ${approval.status.toLowerCase()}`);

  if (!approve) {
    approval.status = "DENIED";
    log("denied", `You denied "${approval.product.title}" (${fmt(approval.product)}).`);
    return { approval };
  }

  // Re-check at execution time: budget or rules may have changed since the request.
  const decision = evaluateForApprovedPurchase(s.policy, approval.product, spendSnapshot(s.purchases));
  if (decision.outcome === "BLOCK") {
    approval.status = "DENIED";
    log("blocked", `Could not complete approved "${approval.product.title}": ${decision.reasons.join(" ")}`);
    return { approval, error: decision.reasons.join(" ") };
  }
  approval.status = "APPROVED";
  log("approved", `You approved "${approval.product.title}" (${fmt(approval.product)}).`);
  const result = await execute(approval.product, "human", decision, appUrl);
  if ("purchase" in result) approval.purchaseId = result.purchase.id;
  return { approval, result };
}

async function execute(product: Product, approvedBy: Purchase["approvedBy"], decision: Decision, appUrl: string): Promise<PurchaseAttempt> {
  const s = state();
  const purchase: Purchase = {
    id: newId("pur"),
    productId: product.id,
    title: product.title,
    image: product.image,
    merchant: product.merchant,
    amount: product.price,
    currency: product.currency,
    status: "FAILED",
    approvedBy,
    createdAt: new Date().toISOString(),
  };
  const args = { purchaseId: purchase.id, title: product.title, amount: product.price, currency: product.currency };

  try {
    const r = s.wallet.vaultId
      ? await chargeVaultedWallet({ ...args, vaultId: s.wallet.vaultId })
      : await createApprovalOrder(args, appUrl);
    purchase.paypalOrderId = r.orderId;
    purchase.paypalCaptureId = r.captureId;

    if (r.status === "COMPLETED") {
      purchase.status = "COMPLETED";
      s.purchases.unshift(purchase);
      log("allowed", `Paid ${fmt(product)} for "${product.title}" with PayPal (order ${r.orderId}). ${decision.reasons.join(" ")}`);
      return { outcome: "PURCHASED", purchase, decision };
    }
    if (r.payerActionUrl) {
      purchase.status = "PENDING_PAYER";
      purchase.payerActionUrl = r.payerActionUrl;
      s.purchases.unshift(purchase);
      log("paypal", `"${product.title}" needs one-time PayPal approval (no saved wallet yet).`);
      return { outcome: "PENDING_PAYER", purchase, decision };
    }
    throw new Error(`Unexpected PayPal order status ${r.status}`);
  } catch (e) {
    purchase.error = e instanceof Error ? e.message : String(e);
    s.purchases.unshift(purchase);
    log("error", `Payment failed for "${product.title}": ${purchase.error}`);
    return { outcome: "FAILED", error: purchase.error, decision };
  }
}

export async function refundPurchase(purchaseId: string) {
  const s = state();
  const p = s.purchases.find((x) => x.id === purchaseId);
  if (!p) throw new Error("Purchase not found");
  if (p.status !== "COMPLETED" || !p.paypalCaptureId) throw new Error("Only completed purchases can be refunded");
  const r = await refundCapture(p.paypalCaptureId);
  p.status = "REFUNDED";
  log("refund", `Refunded ${p.currency} ${p.amount.toFixed(2)} for "${p.title}" (refund ${r.id}).`);
  return p;
}

function fmt(p: Product) {
  return `${p.currency} ${p.price.toFixed(2)}`;
}
