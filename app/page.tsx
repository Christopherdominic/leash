"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityEvent, Approval, ChatMessage, Policy, Purchase } from "@/lib/types";

type AgentStep =
  | { type: "search"; query: string; count: number }
  | { type: "purchase"; title: string; amount: string; outcome: string; reasons: string[] };

type AppState = {
  policy: Policy;
  purchases: Purchase[];
  approvals: Approval[];
  activity: ActivityEvent[];
  chat: ChatMessage[];
  wallet: { connected: boolean; email?: string };
  spend: { spentThisMonth: number; purchasesToday: number };
  integrations: { paypal: "live-sandbox" | "mock"; catalog: "channel3" | "demo"; ai: string | null; phonePush: boolean };
};

type Turn = { role: "user" | "assistant"; content: string; steps?: AgentStep[] };

const SUGGESTIONS = [
  "Buy paper towels and dish soap",
  "I need an air fryer",
  "Get me a bottle of red wine",
  "Buy noise cancelling headphones",
  "Order paper towels and laundry pods",
];

async function api<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined && method === "GET" ? "GET" : method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

const money = (n: number, c = "USD") => `${c === "USD" ? "$" : c + " "}${n.toFixed(2)}`;

export default function Home() {
  const [s, setS] = useState<AppState | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [voice, setVoice] = useState<"idle" | "recording" | "transcribing">("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);

  // Record from the mic, send the clip to /api/transcribe, and put the words in the input so you can check them before sending.
  async function toggleVoice() {
    if (voice === "recording") {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setBanner("Voice input isn't supported in this browser.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      setBanner("Microphone access was blocked. Allow it in your browser to use voice input.");
      return;
    }
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      if (!blob.size) return setVoice("idle");
      setVoice("transcribing");
      try {
        const wav = await toWav(blob);
        const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Transcription failed");
        if (data.text) setInput((cur) => (cur.trim() ? `${cur.trim()} ${data.text}` : data.text));
        else setBanner("Didn't catch that. Try again a little closer to the mic.");
      } catch (e) {
        setBanner(e instanceof Error ? e.message : String(e));
      } finally {
        setVoice("idle");
      }
    };
    recorderRef.current = rec;
    rec.start();
    setVoice("recording");
    setTimeout(() => rec.state === "recording" && rec.stop(), 60_000);
  }

  const refresh = useCallback(async () => {
    try {
      setS(await api<AppState>("/api/state", undefined, "GET"));
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2500);
    const q = new URLSearchParams(window.location.search).get("paypal");
    const msgs: Record<string, string> = {
      connected: "PayPal wallet connected. Your agent can now pay, but only inside your rules.",
      paid: "PayPal payment approved and captured.",
      cancelled: "PayPal step cancelled.",
      error: "PayPal returned an error. Check the activity feed.",
    };
    if (q && msgs[q]) {
      setBanner(msgs[q]);
      window.history.replaceState({}, "", "/");
    }
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setInput("");
    setTurns((t) => [...t, { role: "user", content: text }]);
    setBusy(true);
    try {
      const r = await api<{ reply: string; steps: AgentStep[] }>("/api/agent", { message: text });
      setTurns((t) => [...t, { role: "assistant", content: r.reply, steps: r.steps }]);
    } catch (e) {
      setTurns((t) => [...t, { role: "assistant", content: `Something went wrong: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
      refresh();
    }
  }

  // One action at a time, so a double click can't approve, pay or connect twice.
  const acting = useRef(false);
  const [actBusy, setActBusy] = useState(false);
  async function act(fn: () => Promise<unknown>) {
    if (acting.current) return;
    acting.current = true;
    setActBusy(true);
    try {
      await fn();
    } catch (e) {
      setBanner((e as Error).message);
    } finally {
      acting.current = false;
      setActBusy(false);
    }
    refresh();
  }

  if (!s) return <div className="empty">Loading Leash…</div>;

  const pending = s.approvals.filter((a) => a.status === "PENDING");
  const pct = Math.min(100, (s.spend.spentThisMonth / Math.max(1, s.policy.monthlyBudget)) * 100);

  return (
    <>
      <header className="top">
        <div className="brand">
          <div className="logo">L</div>
          Leash <small>your AI shops, your rules hold</small>
        </div>
        <div className="top-actions">
          {s.wallet.connected ? (
            <span className="pill ok">
              <span className="dot" /> PayPal connected{s.wallet.email ? ` · ${s.wallet.email}` : ""}
            </span>
          ) : (
            <button
              className="btn primary"
              onClick={() =>
                act(async () => {
                  const r = await api<{ approveUrl: string }>("/api/paypal/connect");
                  window.location.href = r.approveUrl;
                })
              }
            >
              Connect PayPal wallet
            </button>
          )}
          {s.wallet.connected && (
            <button className="btn small" onClick={() => act(() => api("/api/paypal/disconnect"))}>
              Disconnect
            </button>
          )}
          <button
            className={`switch ${s.policy.paused ? "on" : ""}`}
            onClick={() => act(() => api("/api/policy", { ...s.policy, paused: !s.policy.paused }, "PUT"))}
            title="Kill switch: instantly stop all agent spending"
          >
            {s.policy.paused ? "■ Agent paused" : "Pause agent"}
          </button>
        </div>
      </header>

      {banner && (
        <div className="banner" onClick={() => setBanner(null)}>
          {banner}
        </div>
      )}

      <main className={`layout${actBusy ? " acting" : ""}`}>
        <section className="col">
          <div className="card chat">
            <h2>
              Shopping agent
              <span className="integrations">
                <span className={`pill ${s.integrations.ai ? "accent" : ""}`}>{s.integrations.ai ?? "offline agent"}</span>
                <span className={`pill ${s.integrations.catalog === "channel3" ? "accent" : ""}`}>
                  {s.integrations.catalog === "channel3" ? "Channel3 catalog" : "demo catalog"}
                </span>
                <span className={`pill ${s.integrations.paypal === "live-sandbox" ? "accent" : ""}`}>
                  {s.integrations.paypal === "live-sandbox" ? "PayPal sandbox" : "PayPal mock"}
                </span>
              </span>
            </h2>
            <div className="messages">
              {turns.length === 0 && (
                <div className="empty">
                  <div className="big">🦮</div>
                  <p>
                    Tell the agent what you need. It searches, picks, and pays with PayPal, but every purchase goes through your
                    rules first. Small and allowed → bought. Big → you approve. Forbidden → blocked.
                  </p>
                </div>
              )}
              {turns.map((t, i) => (
                <div key={i} className={`msg ${t.role}`}>
                  {t.role === "assistant" ? <Rich text={t.content} /> : t.content}
                  {t.steps && t.steps.length > 0 && (
                    <div className="steps">
                      {t.steps.map((st, j) => (
                        <StepRow key={j} step={st} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {busy && <div className="msg assistant muted">Agent is shopping…</div>}
              <div ref={endRef} />
            </div>
            {turns.length === 0 && (
              <div className="suggest">
                {SUGGESTIONS.map((x) => (
                  <button key={x} onClick={() => send(x)}>
                    {x}
                  </button>
                ))}
              </div>
            )}
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={voice === "recording" ? "Listening… tap the mic to stop" : voice === "transcribing" ? "Transcribing…" : "e.g. Restock my groceries for the week"}
              />
              <button
                type="button"
                className={`btn mic ${voice === "recording" ? "recording" : ""}`}
                onClick={toggleVoice}
                disabled={busy || voice === "transcribing"}
                aria-label={voice === "recording" ? "Stop recording" : "Speak your request"}
                title={voice === "recording" ? "Stop recording" : "Speak your request"}
              >
                <MicIcon />
              </button>
              <button className="btn dark" disabled={busy || !input.trim()}>
                Send
              </button>
            </form>
          </div>

          <div className="card">
            <h2>Purchases</h2>
            {s.purchases.length === 0 ? (
              <p className="muted">Nothing bought yet.</p>
            ) : (
              <div className="list">
                {s.purchases.map((p) => (
                  <div className="item" key={p.id}>
                    <div className="t">
                      <div>{p.title}</div>
                      <div className="sub">
                        {p.paypalOrderId ?? "no order"} · {p.approvedBy === "human" ? "approved by you" : "auto-approved"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <StatusPill p={p} />
                      <span className="amount">{money(p.amount, p.currency)}</span>
                      {p.status === "PENDING_PAYER" && p.payerActionUrl && (
                        <a className="btn small primary" href={p.payerActionUrl}>
                          Approve in PayPal
                        </a>
                      )}
                      {p.status === "COMPLETED" && (
                        <button className="btn small" onClick={() => act(() => api(`/api/purchases/${p.id}/refund`))}>
                          Refund
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="col">
          <div className="card">
            <h2>
              Monthly budget
              <button className="btn small" onClick={() => act(async () => (await api("/api/reset"), setTurns([])))}>
                Reset demo
              </button>
            </h2>
            <div className="budget-num">
              {money(s.spend.spentThisMonth, s.policy.currency)} <span>of {money(s.policy.monthlyBudget, s.policy.currency)}</span>
            </div>
            <div className="meter">
              <div className={pct >= 100 ? "full" : pct >= 75 ? "warn" : ""} style={{ width: `${pct}%` }} />
            </div>
            <div className="meta">
              <span>
                {s.spend.purchasesToday}/{s.policy.maxPurchasesPerDay} purchases today
              </span>
              <span>Auto-approve ≤ {money(s.policy.autoApproveLimit, s.policy.currency)}</span>
              <span>Never &gt; {money(s.policy.hardLimit, s.policy.currency)}</span>
            </div>
          </div>

          <div className="card">
            <h2>
              Approval inbox {pending.length > 0 && <span className="pill ask">{pending.length} waiting</span>}
            </h2>
            {pending.length === 0 ? (
              <p className="muted">Nothing waiting. Purchases over your auto-approve limit land here.</p>
            ) : (
              pending.map((a) => (
                <div className="approval" key={a.id}>
                  <div className="row">
                    <span className="title">{a.product.title}</span>
                    <span className="price">{money(a.product.price, a.product.currency)}</span>
                  </div>
                  <div className="why">{a.reasons.join(" ")}</div>
                  <div className="actions">
                    <button className="btn ok small" onClick={() => act(() => api(`/api/approvals/${a.id}`, { approve: true }))}>
                      Approve & pay
                    </button>
                    <button className="btn no small" onClick={() => act(() => api(`/api/approvals/${a.id}`, { approve: false }))}>
                      Deny
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <RulesCard policy={s.policy} aiReady={Boolean(s.integrations.ai)} onSaved={refresh} />

          <div className="card">
            <h2>Activity</h2>
            {s.activity.length === 0 ? (
              <p className="muted">Every search, decision and payment is logged here.</p>
            ) : (
              <div className="list feed">
                {s.activity.slice(0, 25).map((e) => (
                  <div className="item" key={e.id}>
                    <span className="ico">{ICON[e.kind]}</span>
                    <span style={{ flex: 1 }}>{e.message}</span>
                    <time>{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </main>
    </>
  );
}

const ICON: Record<ActivityEvent["kind"], string> = {
  search: "🔎",
  allowed: "✅",
  approval: "⏸️",
  blocked: "⛔",
  approved: "👍",
  denied: "✋",
  refund: "↩️",
  policy: "📏",
  paypal: "🅿️",
  error: "⚠️",
};

function StepRow({ step }: { step: AgentStep }) {
  if (step.type === "search") {
    return (
      <div className="step">
        🔎 <span>
          Searched <b>{step.query}</b> · {step.count} results
        </span>
      </div>
    );
  }
  const map: Record<string, [string, string, string]> = {
    PURCHASED: ["ok", "✅", "Bought"],
    NEEDS_APPROVAL: ["ask", "⏸️", "Needs your approval"],
    PENDING_PAYER: ["ask", "🅿️", "Approve in PayPal"],
    BLOCKED: ["no", "⛔", "Blocked by your rules"],
    FAILED: ["no", "⚠️", "Payment failed"],
  };
  const [cls, ico, label] = map[step.outcome] ?? ["", "•", step.outcome];
  return (
    <div className={`step ${cls}`}>
      {ico}
      <span>
        <b>{label}:</b> {step.title} · {step.amount}
        {step.reasons.length > 0 && <span className="why">{step.reasons.join(" ")}</span>}
      </span>
    </div>
  );
}

function StatusPill({ p }: { p: Purchase }) {
  const m: Record<Purchase["status"], [string, string]> = {
    COMPLETED: ["ok", "Paid"],
    PENDING_PAYER: ["ask", "Awaiting PayPal"],
    REFUNDED: ["", "Refunded"],
    FAILED: ["no", "Failed"],
  };
  const [cls, label] = m[p.status];
  return (
    <span className={`pill ${cls}`} title={p.error}>
      {label}
    </span>
  );
}

function RulesCard({ policy, aiReady, onSaved }: { policy: Policy; aiReady: boolean; onSaved: () => void }) {
  const [form, setForm] = useState(() => toForm(policy));
  const [dirty, setDirty] = useState(false);
  const [nl, setNl] = useState("");
  const [draft, setDraft] = useState<{ policy: Policy; summary: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!dirty) setForm(toForm(policy));
  }, [policy, dirty]);

  const set = (k: keyof ReturnType<typeof toForm>, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  async function save(p: Partial<Policy>) {
    setErr(null);
    try {
      await api("/api/policy", { ...policy, ...p }, "PUT");
      setDirty(false);
      setDraft(null);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function parse() {
    setErr(null);
    setWorking(true);
    try {
      setDraft(await api<{ policy: Policy; summary: string }>("/api/policy/parse", { text: nl }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card">
      <h2>Spending rules</h2>
      <div className="nl">
        <textarea
          value={nl}
          onChange={(e) => setNl(e.target.value)}
          placeholder={'Write rules in plain English, e.g. "$100 a month, groceries and household only, ask me for anything over $20, never alcohol or gift cards, max 3 orders a day"'}
        />
        <div className="nl-row">
          <span className="muted">{aiReady ? "AI drafts the rules, you confirm, code enforces." : "Add an AI key to use plain-English rules."}</span>
          <button className="btn small dark" disabled={!aiReady || !nl.trim() || working} onClick={parse}>
            {working ? "Reading…" : "Draft rules"}
          </button>
        </div>
        {draft && (
          <div className="draft">
            <div style={{ marginBottom: 6 }}>
              <b>Draft:</b> {draft.summary}
            </div>
            <div className="sub" style={{ fontFamily: "var(--mono)", fontSize: 12, marginBottom: 8 }}>
              ${draft.policy.monthlyBudget}/mo · auto ≤ ${draft.policy.autoApproveLimit} · never &gt; ${draft.policy.hardLimit} · {draft.policy.maxPurchasesPerDay}/day
              <br />
              allow: {draft.policy.allowedCategories.join(", ") || "any"}
              <br />
              block: {draft.policy.blockedKeywords.join(", ") || "none"}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn small ok" onClick={() => save(draft.policy)}>
                Apply these rules
              </button>
              <button className="btn small" onClick={() => setDraft(null)}>
                Discard
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rules-grid">
        <label className="field">
          Monthly budget ({policy.currency})
          <input type="number" min={0} value={form.monthlyBudget} onChange={(e) => set("monthlyBudget", e.target.value)} />
        </label>
        <label className="field">
          Auto-approve up to
          <input type="number" min={0} value={form.autoApproveLimit} onChange={(e) => set("autoApproveLimit", e.target.value)} />
        </label>
        <label className="field">
          Never allow above
          <input type="number" min={0} value={form.hardLimit} onChange={(e) => set("hardLimit", e.target.value)} />
        </label>
        <label className="field">
          Max purchases / day
          <input type="number" min={0} value={form.maxPurchasesPerDay} onChange={(e) => set("maxPurchasesPerDay", e.target.value)} />
        </label>
        <label className="field wide">
          Allowed categories (comma separated, empty = any)
          <input value={form.allowedCategories} onChange={(e) => set("allowedCategories", e.target.value)} />
        </label>
        <label className="field wide">
          Never buy (keywords)
          <input value={form.blockedKeywords} onChange={(e) => set("blockedKeywords", e.target.value)} />
        </label>
      </div>
      {dirty && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn small dark" onClick={() => save(fromForm(form))}>
            Save rules
          </button>
          <button
            className="btn small"
            onClick={() => {
              setForm(toForm(policy));
              setDirty(false);
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

function toForm(p: Policy) {
  return {
    monthlyBudget: String(p.monthlyBudget),
    autoApproveLimit: String(p.autoApproveLimit),
    hardLimit: String(p.hardLimit),
    maxPurchasesPerDay: String(p.maxPurchasesPerDay),
    allowedCategories: p.allowedCategories.join(", "),
    blockedKeywords: p.blockedKeywords.join(", "),
  };
}

function fromForm(f: ReturnType<typeof toForm>): Partial<Policy> {
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  return {
    monthlyBudget: Number(f.monthlyBudget),
    autoApproveLimit: Number(f.autoApproveLimit),
    hardLimit: Number(f.hardLimit),
    maxPurchasesPerDay: Number(f.maxPurchasesPerDay),
    allowedCategories: list(f.allowedCategories),
    blockedKeywords: list(f.blockedKeywords),
  };
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/** Convert a browser recording (usually WebM) to 16 kHz mono WAV, a format every model accepts. */
async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const rate = 16000;
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const pcm = (await offline.startRendering()).getChannelData(0);
    // Normalize quiet recordings so speech is loud enough to hear clearly.
    let peak = 0;
    for (const v of pcm) peak = Math.max(peak, Math.abs(v));
    if (peak > 0.01 && peak < 0.9) {
      const gain = 0.9 / peak;
      for (let i = 0; i < pcm.length; i++) pcm[i] *= gain;
    }
    const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const str = (o: number, t: string) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    str(0, "RIFF"); out.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVE");
    str(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
    out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
    str(36, "data"); out.setUint32(40, pcm.length * 2, true);
    pcm.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
    return new Blob([out], { type: "audio/wav" });
  } finally {
    ctx.close();
  }
}

/** Shows the agent's **bold** text as bold instead of raw asterisks. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
      )}
    </>
  );
}
