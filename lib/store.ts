import { dbEnabled, loadDoc, saveDoc } from "./db";
import { DEFAULT_POLICY } from "./policy";
import type { ActivityEvent, Approval, ChatMessage, Policy, Product, Purchase } from "./types";

/**
 * App state for a single user. Kept in memory on globalThis (survives Next.js
 * hot reloads) and, when DATABASE_URL is set, saved to Postgres after every
 * change so the wallet, rules, purchases and activity survive restarts.
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

const g = globalThis as unknown as { __leash?: State; __leashLoad?: Promise<void>; __leashLoaded?: boolean };

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

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

type Saved = Omit<State, "productCache"> & { productCache: [string, Product][] };

function toSaved(s: State): Saved {
  // Keep the most recent products so pending approvals and the agent's picks still resolve.
  return { ...s, productCache: [...s.productCache.entries()].slice(-300) };
}

function fromSaved(d: Partial<Saved>): State {
  const base = fresh();
  return {
    ...base,
    ...d,
    policy: { ...base.policy, ...d.policy },
    wallet: { ...d.wallet },
    productCache: new Map(d.productCache ?? []),
  } as State;
}

/** Load saved state from the database once per server process. */
export async function ready(): Promise<void> {
  if (!dbEnabled() || g.__leashLoaded) return;
  g.__leashLoad ??= (async () => {
    const doc = await loadDoc();
    if (doc) g.__leash = fromSaved(doc as Partial<Saved>);
    g.__leashLoaded = true;
  })().catch((e) => {
    g.__leashLoad = undefined; // try again on the next request
    throw e;
  });
  await g.__leashLoad;
}

/** Save state. Never saves before a successful load, so a DB hiccup can't wipe real data. */
export async function persist(): Promise<void> {
  if (!dbEnabled() || !g.__leashLoaded) return;
  await saveDoc(toSaved(state()));
}

/** Wrap an API route: load state first, save it afterwards (even if the handler throws). */
export function withState<A extends unknown[]>(handler: (...args: A) => Promise<Response>, opts: { save?: boolean } = {}) {
  return async (...args: A): Promise<Response> => {
    await ready();
    try {
      return await handler(...args);
    } finally {
      if (opts.save !== false) await persist().catch((e) => console.error("Leash: failed to save state", e));
    }
  };
}
