import { DEFAULT_POLICY } from "./policy";
import type { ActivityEvent, Approval, ChatMessage, Policy, Product, Purchase } from "./types";

/**
 * In-memory state for a single-user demo. Kept on globalThis so it survives
 * Next.js hot reloads. Swap for a database (e.g. Render Postgres) after the
 * hackathon.
 */
type State = {
  policy: Policy;
  purchases: Purchase[];
  approvals: Approval[];
  activity: ActivityEvent[];
  chat: ChatMessage[];
  /** Products the agent has seen, keyed by id. The agent can only buy from here. */
  productCache: Map<string, Product>;
  wallet: {
    vaultId?: string;
    customerId?: string;
    email?: string;
    pendingSetupTokenId?: string;
  };
};

const g = globalThis as unknown as { __leash?: State };

function fresh(): State {
  return {
    policy: { ...DEFAULT_POLICY },
    purchases: [],
    approvals: [],
    activity: [],
    chat: [],
    productCache: new Map(),
    wallet: {},
  };
}

export function state(): State {
  if (!g.__leash) g.__leash = fresh();
  return g.__leash;
}

export function resetState(keepWallet = true) {
  const wallet = g.__leash?.wallet ?? {};
  g.__leash = fresh();
  if (keepWallet) g.__leash.wallet = wallet;
}

export function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function log(kind: ActivityEvent["kind"], message: string) {
  const s = state();
  s.activity.unshift({ id: newId("evt"), at: new Date().toISOString(), kind, message });
  s.activity = s.activity.slice(0, 200);
}

export function publicState() {
  const s = state();
  return {
    policy: s.policy,
    purchases: s.purchases,
    approvals: s.approvals,
    activity: s.activity,
    chat: s.chat,
    wallet: { connected: Boolean(s.wallet.vaultId), email: s.wallet.email },
  };
}
