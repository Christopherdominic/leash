// Shared types for Leash.

export type Policy = {
  /** ISO currency code. PayPal sandbox does not support NGN, so the demo uses USD. */
  currency: string;
  /** Total the agent may spend per calendar month. */
  monthlyBudget: number;
  /** Purchases at or below this amount go through automatically. */
  autoApproveLimit: number;
  /** Purchases above this amount are always blocked, even with approval. */
  hardLimit: number;
  /** If non-empty, the product's catalog category must match one of these. */
  allowedCategories: string[];
  /** Products whose title, brand or category contains any of these are blocked. */
  blockedKeywords: string[];
  /** Max successful purchases per day (velocity limit). */
  maxPurchasesPerDay: number;
  /** Kill switch: when true the agent cannot spend at all. */
  paused: boolean;
};

export type Product = {
  id: string;
  title: string;
  brand?: string;
  /** Category words from the catalog (trusted source), lowercase. */
  categories: string[];
  price: number;
  currency: string;
  url?: string;
  merchant?: string;
  image?: string;
};

export type Decision =
  | { outcome: "ALLOW"; reasons: string[] }
  | { outcome: "NEEDS_APPROVAL"; reasons: string[] }
  | { outcome: "BLOCK"; reasons: string[] };

export type Purchase = {
  id: string;
  productId: string;
  title: string;
  image?: string;
  merchant?: string;
  amount: number;
  currency: string;
  status: "COMPLETED" | "PENDING_PAYER" | "REFUNDED" | "FAILED";
  paypalOrderId?: string;
  paypalCaptureId?: string;
  payerActionUrl?: string;
  approvedBy: "policy" | "human";
  createdAt: string;
  error?: string;
};

export type Approval = {
  id: string;
  product: Product;
  reasons: string[];
  status: "PENDING" | "APPROVED" | "DENIED";
  createdAt: string;
  purchaseId?: string;
  /** The Telegram message with Approve / Deny buttons, so it can be updated once decided. */
  telegram?: { chatId: string; messageId: number; photo: boolean };
};

export type ActivityEvent = {
  id: string;
  at: string;
  kind: "search" | "allowed" | "approval" | "blocked" | "approved" | "denied" | "refund" | "policy" | "paypal" | "error";
  message: string;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };
