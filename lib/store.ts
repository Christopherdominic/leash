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
  wallet: Wallet;
  /** Saved history of wallets that were disconnected, keyed by PayPal account. */
  archives: Record<string, History>;
};

type Wallet = {
  vaultId?: string;
  customerId?: string;
  email?: string;
  pendingSetupTokenId?: string;
};

/** Everything that belongs to one PayPal account's history. Rules stay shared. */
type History = Pick<State, "purchases" | "approvals" | "activity" | "chat">;

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
    archives: {},
  };
}

export function state(): State {
  if (!g.__leash) g.__leash = fresh();
  return g.__leash;
}

export function resetState(keepWallet = true) {
  const wallet = g.__leash?.wallet ?? {};
  const archives = g.__leash?.archives ?? {};
  g.__leash = fresh();
  g.__leash.archives = archives;
  if (keepWallet) g.__leash.wallet = wallet;
}

function walletKey(w: Wallet): string | undefined {
  return (w.email ?? w.customerId)?.toLowerCase();
}

/**
 * Disconnect: file the current history under this PayPal account and start the
 * dashboard empty. Reconnecting the same account brings it back.
 */
export function archiveCurrentWallet(): string | undefined {
  const s = state();
  const key = walletKey(s.wallet);
  const label = s.wallet.email;
  if (key) {
    s.archives[key] = { purchases: s.purchases, approvals: s.approvals, activity: s.activity, chat: s.chat };
    s.purchases = [];
    s.approvals = [];
    s.activity = [];
    s.chat = [];
  }
  s.wallet = {};
  return label;
}

/**
 * Connect: make this the active wallet. If it was connected before, its saved
 * history comes back, merged with anything done since disconnecting.
 * Returns how many purchases were restored (0 for a new account).
 */
export function activateWallet(w: Wallet): number {
  const s = state();
  s.wallet = w;
  const key = walletKey(w);
  const saved = key ? s.archives[key] : undefined;
  if (!key || !saved) return 0;
  delete s.archives[key];
  const newest = <T>(at: (x: T) => string) => (a: T, b: T) => at(b).localeCompare(at(a));
  s.purchases = [...s.purchases, ...saved.purchases].sort(newest((x) => x.createdAt));
  s.approvals = [...s.approvals, ...saved.approvals].sort(newest((x) => x.createdAt));
  s.activity = [...s.activity, ...saved.activity].sort(newest((x) => x.at)).slice(0, 200);
  s.chat = [...saved.chat, ...s.chat];
  return saved.purchases.length;
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
    archives: { ...d.archives },
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
