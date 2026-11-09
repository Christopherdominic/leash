/**
 * PayPal REST client (sandbox by default).
 *
 * Flow:
 *  1. The user connects their PayPal once: create a vault *setup token*, send
 *     them to PayPal to approve, then exchange it for a *payment token*
 *     (vault_id). This is the "leash" being clipped on.
 *  2. When the rules engine allows a purchase, Leash creates an Orders v2 order
 *     with payment_source.paypal.vault_id. PayPal charges the saved wallet
 *     without the user being present and returns status COMPLETED.
 *  3. Fallback if Vault is not enabled on the app: a normal order that the user
 *     approves in a PayPal popup (status PAYER_ACTION_REQUIRED).
 *
 * Set MOCK_PAYPAL=1 (or leave credentials empty) to run without PayPal at all.
 */

const BASE = process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";

export function paypalMode(): "live-sandbox" | "mock" {
  if (process.env.MOCK_PAYPAL === "1") return "mock";
  return process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET ? "live-sandbox" : "mock";
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function pp<T>(path: string, init: { method?: string; body?: unknown; requestId?: string } = {}): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = [j.name, j.message, j.details?.map((d: { issue: string; description?: string }) => `${d.issue}: ${d.description ?? ""}`).join("; ")]
        .filter(Boolean)
        .join(" | ");
    } catch {}
    throw new Error(`PayPal ${path} failed (${res.status}): ${detail}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

type Link = { href: string; rel: string; method?: string };

// ---------------------------------------------------------------------------
// Vault: save the user's PayPal wallet for agent purchases
// ---------------------------------------------------------------------------

export async function createSetupToken(appUrl: string): Promise<{ id: string; approveUrl: string }> {
  if (paypalMode() === "mock") {
    const id = `MOCK-SETUP-${Date.now()}`;
    return { id, approveUrl: `${appUrl}/api/paypal/return?mock=1&approval_token_id=${id}` };
  }
  const data = await pp<{ id: string; links: Link[] }>("/v3/vault/setup-tokens", {
    requestId: `setup-${Date.now()}`,
    body: {
      payment_source: {
        paypal: {
          description: "Leash: lets your AI shopping agent pay within the rules you set",
          permit_multiple_payment_tokens: false,
          usage_pattern: "IMMEDIATE",
          usage_type: "MERCHANT",
          customer_type: "CONSUMER",
          experience_context: {
            brand_name: "Leash",
            shipping_preference: "NO_SHIPPING",
            return_url: `${appUrl}/api/paypal/return`,
            cancel_url: `${appUrl}/?paypal=cancelled`,
          },
        },
      },
    },
  });
  const approve = data.links.find((l) => l.rel === "approve");
  if (!approve) throw new Error("PayPal did not return an approve link for the setup token.");
  return { id: data.id, approveUrl: approve.href };
}

export async function createPaymentToken(setupTokenId: string): Promise<{ vaultId: string; customerId?: string; email?: string }> {
  if (paypalMode() === "mock") {
    return { vaultId: `MOCK-VAULT-${Date.now()}`, customerId: "mock-customer", email: "buyer@sandbox.mock" };
  }
  const data = await pp<{
    id: string;
    customer?: { id: string };
    payment_source?: { paypal?: { email_address?: string } };
  }>("/v3/vault/payment-tokens", {
    requestId: `ptoken-${setupTokenId}`,
    body: { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } },
  });
  return { vaultId: data.id, customerId: data.customer?.id, email: data.payment_source?.paypal?.email_address };
}

export async function deletePaymentToken(vaultId: string) {
  if (paypalMode() === "mock") return;
  await pp(`/v3/vault/payment-tokens/${vaultId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Orders: pay for an approved purchase
// ---------------------------------------------------------------------------

export type OrderResult = {
  orderId: string;
  status: string;
  captureId?: string;
  payerActionUrl?: string;
};

type OrderResponse = {
  id: string;
  status: string;
  links?: Link[];
  purchase_units?: { payments?: { captures?: { id: string; status: string }[] } }[];
};

function toResult(o: OrderResponse): OrderResult {
  return {
    orderId: o.id,
    status: o.status,
    captureId: o.purchase_units?.[0]?.payments?.captures?.[0]?.id,
    payerActionUrl: o.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href,
  };
}

function purchaseUnit(p: { purchaseId: string; title: string; amount: number; currency: string }) {
  return {
    reference_id: p.purchaseId,
    custom_id: p.purchaseId,
    description: `Leash agent purchase: ${p.title}`.slice(0, 127),
    amount: { currency_code: p.currency, value: p.amount.toFixed(2) },
  };
}

/** Charge the saved wallet. The user is not present; the rules engine already approved this. */
export async function chargeVaultedWallet(p: {
  purchaseId: string;
  title: string;
  amount: number;
  currency: string;
  vaultId: string;
}): Promise<OrderResult> {
  if (paypalMode() === "mock") {
    return { orderId: `MOCK-ORDER-${p.purchaseId}`, status: "COMPLETED", captureId: `MOCK-CAPTURE-${p.purchaseId}` };
  }
  const o = await pp<OrderResponse>("/v2/checkout/orders", {
    requestId: `order-${p.purchaseId}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [purchaseUnit(p)],
      payment_source: { paypal: { vault_id: p.vaultId } },
    },
  });
  return toResult(o);
}

/** Fallback when no wallet is saved: the user approves this one payment in PayPal. */
export async function createApprovalOrder(
  p: { purchaseId: string; title: string; amount: number; currency: string },
  appUrl: string,
): Promise<OrderResult> {
  if (paypalMode() === "mock") {
    return {
      orderId: `MOCK-ORDER-${p.purchaseId}`,
      status: "PAYER_ACTION_REQUIRED",
      payerActionUrl: `${appUrl}/api/paypal/order-return?mock=1&purchase=${p.purchaseId}&token=MOCK-ORDER-${p.purchaseId}`,
    };
  }
  const o = await pp<OrderResponse>("/v2/checkout/orders", {
    requestId: `order-${p.purchaseId}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [purchaseUnit(p)],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Leash",
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            return_url: `${appUrl}/api/paypal/order-return?purchase=${p.purchaseId}`,
            cancel_url: `${appUrl}/?paypal=cancelled`,
          },
        },
      },
    },
  });
  return toResult(o);
}

export async function captureOrder(orderId: string): Promise<OrderResult> {
  if (paypalMode() === "mock") return { orderId, status: "COMPLETED", captureId: `MOCK-CAPTURE-${orderId}` };
  const o = await pp<OrderResponse>(`/v2/checkout/orders/${orderId}/capture`, { requestId: `capture-${orderId}`, body: {} });
  return toResult(o);
}

export async function refundCapture(captureId: string): Promise<{ id: string; status: string }> {
  if (paypalMode() === "mock") return { id: `MOCK-REFUND-${captureId}`, status: "COMPLETED" };
  return pp(`/v2/payments/captures/${captureId}/refund`, { requestId: `refund-${captureId}`, body: {} });
}
