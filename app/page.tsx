"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityEvent, Approval, ChatMessage, Policy, Purchase } from "@/lib/types";

type AgentStep =
  | { type: "search"; query: string; count: number }
  | { type: "purchase"; title: string; amount: string; outcome: string; reasons: string[]; image?: string; merchant?: string };

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

  // Toasts disappear on their own after a few seconds.
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 7000);
    return () => clearTimeout(t);
  }, [banner]);

  function startBrowserSpeech(): boolean {
    const w = window as unknown as { SpeechRecognition?: SpeechRecCtor; webkitSpeechRecognition?: SpeechRecCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return false;
    const rec = new Ctor();
    rec.lang = "en-NG";
    rec.continuous = true;
    rec.interimResults = true;
    const before = input.trim();
    let finalText = "";
    let failed = false;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      setInput([before, (finalText + interim).trim()].filter(Boolean).join(" "));
    };
    let heard = false;
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      failed = true;
      if (e.error === "not-allowed") {
        setBanner("Microphone access was blocked. Allow it in your browser to use voice input.");
        return;
      }
      // network, service-not-allowed, language-not-supported…: switch to recording for good.
      speechBroken.current = true;
    };
    const onresult = rec.onresult;
    rec.onresult = (e) => {
      heard = true;
      onresult?.(e);
    };
    rec.onend = () => {
      speechRef.current = null;
      setVoice("idle");
      if (!heard && !(failed && !speechBroken.current)) {
        // Browser speech gave nothing (often it silently can't reach Google on Linux):
        // use the record-and-transcribe mic from now on.
        speechBroken.current = true;
        try {
          localStorage.setItem("leash.voiceBackup", "1");
        } catch {}
        setBanner("Switched to backup voice mode. Tap the mic and speak again.");
        return;
      }
      if (!failed) setInput([before, finalText.trim()].filter(Boolean).join(" "));
    };
    speechRef.current = rec;
    rec.start();
    setVoice("recording");
    return true;
  }

  // Record from the mic, send the clip to /api/transcribe, and put the words in the input so you can check them before sending.
  const speechRef = useRef<SpeechRec | null>(null);
  const speechBroken = useRef(false);
  useEffect(() => {
    try {
      speechBroken.current = localStorage.getItem("leash.voiceBackup") === "1";
    } catch {}
  }, []);

  async function toggleVoice() {
    if (voice === "recording") {
      speechRef.current?.stop();
      recorderRef.current?.stop();
      return;
    }
    // Chrome and Edge: try the browser's own speech recognition (live words, Nigerian English).
    // On Linux it often can't reach Google's speech service, so fall back to recording.
    if (!speechBroken.current && startBrowserSpeech()) return;
    await startRecording();
  }

  async function startRecording() {
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

  const hydrated = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const next = await api<AppState>("/api/state", undefined, "GET");
      setS(next);
      // After a page reload, bring back the earlier conversation (text only).
      if (!hydrated.current) {
        hydrated.current = true;
        setTurns((t) => (t.length ? t : next.chat.map((m) => ({ role: m.role, content: m.content }))));
      }
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

  // Keep the chat scrolled to the newest message without moving the whole page.
  useEffect(() => {
    const box = endRef.current?.parentElement;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
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

  if (!s) {
    return (
      <div className="loading">
        <Logo size={36} />
        <span>Loading Leash…</span>
      </div>
    );
  }

  const pending = s.approvals.filter((a) => a.status === "PENDING");
  const pct = Math.min(100, (s.spend.spentThisMonth / Math.max(1, s.policy.monthlyBudget)) * 100);
  const remaining = Math.max(0, s.policy.monthlyBudget - s.spend.spentThisMonth);
  const cur = s.policy.currency;
  const paused = s.policy.paused;
  // PayPal only runs in its sandbox (or mocked), so no real money ever moves.
  const sandbox = s.integrations.paypal === "live-sandbox" || s.integrations.paypal === "mock";

  const connect = () =>
    act(async () => {
      const r = await api<{ approveUrl: string }>("/api/paypal/connect");
      window.location.href = r.approveUrl;
    });

  return (
    <div className={`app${actBusy ? " acting" : ""}`}>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <Logo />
            <span className="wordmark">Leash</span>
            {sandbox && (
              <span className="env-badge" title="Payments use PayPal's test environment. No real money moves.">
                Sandbox
              </span>
            )}
          </div>
          <div className="topbar-actions">
            <button
              className={`agent-toggle${paused ? " off" : ""}`}
              role="switch"
              aria-checked={!paused}
              onClick={() => act(() => api("/api/policy", { ...s.policy, paused: !paused }, "PUT"))}
              title="Kill switch: instantly stop all agent spending"
            >
              <span className="track">
                <span className="thumb" />
              </span>
              <span className="label">{paused ? "Agent paused" : "Agent active"}</span>
            </button>
            {s.wallet.connected ? (
              <div className="wallet">
                <PayPalMark />
                <div className="wallet-text">
                  <span className="wallet-title">PayPal connected</span>
                  {s.wallet.email && <span className="wallet-email">{s.wallet.email}</span>}
                </div>
                <button
                  className="icon-btn"
                  onClick={() => act(async () => (await api("/api/paypal/disconnect"), setTurns([])))}
                  title="Disconnect wallet (revokes the agent's access at PayPal)"
                  aria-label="Disconnect PayPal wallet"
                >
                  <Icon name="logout" />
                </button>
              </div>
            ) : (
              <button className="btn primary" onClick={connect}>
                <PayPalMark light /> Connect<span className="hide-sm"> PayPal</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {paused && (
        <div className="paused-bar">
          <Icon name="pause" /> Agent spending is paused. Nothing can be bought until you turn the agent back on.
        </div>
      )}

      <main className="page">
        <div className="page-head">
          <div>
            <h1>Overview</h1>
            <p>Your AI shopping agent, working inside the rules you set.</p>
          </div>
          <button
            className="btn ghost"
            onClick={() => act(async () => (await api("/api/reset"), setTurns([])))}
            title="Clear purchases, approvals, chat and rules. Keeps the wallet connected."
          >
            <Icon name="reset" /> Reset demo
          </button>
        </div>

        <section className="stats">
          <div className="stat">
            <span className="stat-label">Spent this month</span>
            <span className="stat-value">{money(s.spend.spentThisMonth, cur)}</span>
            <div className="meter" aria-hidden="true">
              <div className={pct >= 100 ? "full" : pct >= 75 ? "warn" : ""} style={{ width: `${pct}%` }} />
            </div>
            <span className="stat-sub">of {money(s.policy.monthlyBudget, cur)} monthly budget</span>
          </div>
          <div className="stat">
            <span className="stat-label">Remaining</span>
            <span className="stat-value">{money(remaining, cur)}</span>
            <span className="stat-sub">Auto-pays up to {money(s.policy.autoApproveLimit, cur)} per item</span>
          </div>
          <div className={`stat${pending.length ? " attention" : ""}`}>
            <span className="stat-label">Waiting for approval</span>
            <span className="stat-value">{pending.length}</span>
            <span className="stat-sub">{pending.length ? "Review in your inbox" : "You're all caught up"}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Purchases today</span>
            <span className="stat-value">
              {s.spend.purchasesToday}
              <small> / {s.policy.maxPurchasesPerDay}</small>
            </span>
            <span className="stat-sub">Never above {money(s.policy.hardLimit, cur)} per item</span>
          </div>
        </section>

        <div className="grid">
          <section className="col">
            <div className="card chat">
              <div className="card-head">
                <div className="agent-id">
                  <span className="agent-avatar">
                    <Icon name="bot" />
                  </span>
                  <div>
                    <h2>Shopping agent</h2>
                    <span className={`status${paused ? " off" : ""}`}>
                      <span className="dot" /> {paused ? "Paused" : "Ready"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="messages">
                {turns.length === 0 && (
                  <div className="welcome">
                    <h3>What do you need?</h3>
                    <p>Ask in plain words, or tap the mic and say it. The agent finds the best match and checks your rules before paying.</p>
                    <ul className="legend">
                      <li>
                        <span className="legend-ico ok">
                          <Icon name="check" />
                        </span>
                        <span>
                          <b>Pays instantly</b> when it&apos;s small and allowed
                        </span>
                      </li>
                      <li>
                        <span className="legend-ico ask">
                          <Icon name="clock" />
                        </span>
                        <span>
                          <b>Asks you first</b> above {money(s.policy.autoApproveLimit, cur)}
                        </span>
                      </li>
                      <li>
                        <span className="legend-ico no">
                          <Icon name="ban" />
                        </span>
                        <span>
                          <b>Blocks</b> anything your rules forbid
                        </span>
                      </li>
                    </ul>
                    <div className="suggest">
                      {SUGGESTIONS.map((x) => (
                        <button key={x} onClick={() => send(x)} disabled={busy}>
                          {x}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {turns.map((t, i) =>
                  t.role === "user" ? (
                    <div key={i} className="msg user">
                      {t.content}
                    </div>
                  ) : (
                    <div key={i} className="msg-row">
                      <span className="agent-avatar sm">
                        <Icon name="bot" />
                      </span>
                      <div className="msg assistant">
                        <div className="msg-text">
                          <Rich text={t.content} />
                        </div>
                        {t.steps && t.steps.length > 0 && (
                          <div className="steps">
                            <Searches steps={t.steps} />
                            {t.steps.map((st, j) => (st.type === "purchase" ? <StepRow key={j} step={st} /> : null))}
                          </div>
                        )}
                      </div>
                    </div>
                  ),
                )}
                {busy && (
                  <div className="msg-row">
                    <span className="agent-avatar sm">
                      <Icon name="bot" />
                    </span>
                    <div className="msg assistant thinking">
                      <span className="typing" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      Searching and checking your rules…
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </div>

              <form
                className={`composer${voice === "recording" ? " listening" : ""}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  aria-label="Tell the agent what to buy"
                  placeholder={
                    voice === "recording"
                      ? "Listening… tap the mic to stop"
                      : voice === "transcribing"
                        ? "Transcribing…"
                        : "Tell the agent what to buy…"
                  }
                />
                <button
                  type="button"
                  className={`icon-btn mic${voice === "recording" ? " recording" : ""}`}
                  onClick={toggleVoice}
                  disabled={busy || voice === "transcribing"}
                  aria-label={voice === "recording" ? "Stop recording" : "Speak your request"}
                  title={voice === "recording" ? "Stop recording" : "Speak your request"}
                >
                  {voice === "transcribing" ? <span className="spinner" /> : <Icon name="mic" />}
                </button>
                <button className="send" disabled={busy || !input.trim()} aria-label="Send">
                  <Icon name="send" />
                </button>
              </form>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Purchases</h2>
                {s.purchases.length > 0 && <span className="count">{s.purchases.length}</span>}
              </div>
              {s.purchases.length === 0 ? (
                <Empty icon="bag" title="No purchases yet" text="Anything the agent buys shows up here with its PayPal order ID." />
              ) : (
                <div className="table">
                  {s.purchases.map((p) => (
                    <div className="tr" key={p.id}>
                      <Thumb src={p.image} />
                      <div className="td-main">
                        <div className="td-title" title={p.title}>
                          {p.title}
                        </div>
                        <div className="td-sub">
                          {p.merchant ? `${p.merchant} · ` : ""}
                          {p.approvedBy === "human" ? "Approved by you" : "Auto-approved"}
                          {p.paypalOrderId && <span className="mono"> · {p.paypalOrderId}</span>}
                        </div>
                      </div>
                      <StatusPill p={p} />
                      <span className="amount">{money(p.amount, p.currency)}</span>
                      <div className="td-actions">
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
            <div className={`card${pending.length ? " card-attention" : ""}`}>
              <div className="card-head">
                <h2>Approval inbox</h2>
                {pending.length > 0 && <span className="pill ask">{pending.length} waiting</span>}
              </div>
              {pending.length === 0 ? (
                <Empty icon="inbox" title="Nothing to review" text={`Purchases over ${money(s.policy.autoApproveLimit, cur)} wait here for your OK.`} />
              ) : (
                <div className="approvals">
                  {pending.map((a) => (
                    <div className="approval" key={a.id}>
                      <div className="approval-top">
                        <Thumb src={a.product.image} />
                        <div className="td-main">
                          <div className="td-title" title={a.product.title}>
                            {a.product.title}
                          </div>
                          <div className="td-sub">{a.product.merchant ?? "Channel3 catalog"}</div>
                        </div>
                        <span className="amount lg">{money(a.product.price, a.product.currency)}</span>
                      </div>
                      <p className="approval-why">{a.reasons.join(" ")}</p>
                      <div className="approval-actions">
                        <button className="btn ok" onClick={() => act(() => api(`/api/approvals/${a.id}`, { approve: true }))}>
                          <Icon name="check" /> Approve & pay
                        </button>
                        <button className="btn" onClick={() => act(() => api(`/api/approvals/${a.id}`, { approve: false }))}>
                          Deny
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <RulesCard policy={s.policy} aiReady={Boolean(s.integrations.ai)} onSaved={refresh} />

            <div className="card">
              <div className="card-head">
                <h2>Activity</h2>
              </div>
              {s.activity.length === 0 ? (
                <Empty icon="activity" title="No activity yet" text="Every search, decision and payment is logged here." />
              ) : (
                <ol className="timeline">
                  {s.activity.slice(0, 25).map((e) => {
                    const [icon, tone] = ACTIVITY[e.kind];
                    return (
                      <li key={e.id}>
                        <span className={`tl-ico ${tone}`}>
                          <Icon name={icon} />
                        </span>
                        <span className="tl-text">{e.message}</span>
                        <time dateTime={e.at}>{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </aside>
        </div>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span>
            <b>Leash</b> · Spending guardrails for AI shopping agents.
            {sandbox && " Sandbox mode: payments use PayPal's test environment, no real money moves."}
          </span>
          <span className="sys">
            <SysDot ok={Boolean(s.integrations.ai)} label={s.integrations.ai ? s.integrations.ai.replace(/^Google /, "") : "Offline agent"} />
            <SysDot ok={s.integrations.catalog === "channel3"} label={s.integrations.catalog === "channel3" ? "Channel3" : "Demo catalog"} />
            <SysDot ok={s.integrations.paypal === "live-sandbox"} label={s.integrations.paypal === "live-sandbox" ? "PayPal" : "PayPal mock"} />
            {s.integrations.phonePush && <SysDot ok label="Phone alerts" />}
          </span>
        </div>
      </footer>

      {banner && (
        <div className="toast" role="status">
          <span>{banner}</span>
          <button className="icon-btn" onClick={() => setBanner(null)} aria-label="Dismiss">
            <Icon name="x" />
          </button>
        </div>
      )}
    </div>
  );
}

const ACTIVITY: Record<ActivityEvent["kind"], [IconName, string]> = {
  search: ["search", ""],
  allowed: ["check", "ok"],
  approval: ["clock", "ask"],
  blocked: ["ban", "no"],
  approved: ["check", "ok"],
  denied: ["x", "no"],
  refund: ["undo", ""],
  policy: ["sliders", "accent"],
  paypal: ["wallet", "accent"],
  error: ["alert", "no"],
};

/** All of a reply's searches on one line: Searched "air fryer", "dish soap". */
function Searches({ steps }: { steps: AgentStep[] }) {
  const q = steps.flatMap((x) => (x.type === "search" ? [x.query] : []));
  if (!q.length) return null;
  return (
    <div className="step-search">
      <Icon name="search" /> Searched {q.map((x) => `“${x}”`).join(", ")}
    </div>
  );
}

function StepRow({ step }: { step: Extract<AgentStep, { type: "purchase" }> }) {
  const map: Record<string, [string, IconName, string]> = {
    PURCHASED: ["ok", "check", "Paid"],
    NEEDS_APPROVAL: ["ask", "clock", "Needs your approval"],
    PENDING_PAYER: ["ask", "wallet", "Approve in PayPal"],
    BLOCKED: ["no", "ban", "Blocked"],
    FAILED: ["no", "alert", "Payment failed"],
  };
  const [tone, icon, label] = map[step.outcome] ?? ["", "dot", step.outcome];
  return (
    <div className={`step ${tone}`}>
      <Thumb src={step.image} icon={step.image ? "bag" : icon} />
      <div className="step-body">
        <div className="step-top">
          <span className="step-title" title={step.title}>
            {step.title}
          </span>
          <span className="amount">{step.amount.replace(/^USD /, "$")}</span>
        </div>
        <div className="step-meta">
          <span className={`pill ${tone}`}>
            <Icon name={icon} /> {label}
          </span>
          {step.merchant && <span className="td-sub">{step.merchant}</span>}
        </div>
        {step.reasons.length > 0 && <p className="step-why">{step.reasons.join(" ")}</p>}
      </div>
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
      setNl("");
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

  const cur = policy.currency === "USD" ? "$" : policy.currency;

  return (
    <div className="card">
      <div className="card-head">
        <h2>Spending rules</h2>
        <span className="hint">Enforced by code, not the AI</span>
      </div>

      <div className="nl">
        <label className="field-label" htmlFor="nl-rules">
          Describe your rules
        </label>
        <textarea
          id="nl-rules"
          value={nl}
          onChange={(e) => setNl(e.target.value)}
          placeholder={'e.g. "$100 a month, household and kitchen only, ask me over $20, never alcohol or gift cards"'}
        />
        <div className="nl-row">
          <span className="hint">{aiReady ? "AI drafts the rules. You review them before they apply." : "Add an AI key to use plain-English rules."}</span>
          <button className="btn small dark" disabled={!aiReady || !nl.trim() || working} onClick={parse}>
            {working ? (
              <>
                <span className="spinner" /> Reading…
              </>
            ) : (
              <>
                <Icon name="sparkle" /> Draft rules
              </>
            )}
          </button>
        </div>
        {draft && (
          <div className="draft">
            <div className="draft-title">
              <Icon name="sparkle" /> Proposed rules
            </div>
            <p>{draft.summary}</p>
            <dl className="draft-grid">
              <dt>Monthly budget</dt>
              <dd>
                {cur}
                {draft.policy.monthlyBudget}
              </dd>
              <dt>Auto-pay up to</dt>
              <dd>
                {cur}
                {draft.policy.autoApproveLimit}
              </dd>
              <dt>Never above</dt>
              <dd>
                {cur}
                {draft.policy.hardLimit}
              </dd>
              <dt>Per day</dt>
              <dd>{draft.policy.maxPurchasesPerDay} purchases</dd>
              <dt>Allowed</dt>
              <dd>{draft.policy.allowedCategories.join(", ") || "Anything"}</dd>
              <dt>Never buy</dt>
              <dd>{draft.policy.blockedKeywords.join(", ") || "Nothing blocked"}</dd>
            </dl>
            <div className="row-actions">
              <button className="btn small ok" onClick={() => save(draft.policy)}>
                Apply rules
              </button>
              <button className="btn small" onClick={() => setDraft(null)}>
                Discard
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="divider">
        <span>or edit directly</span>
      </div>

      <div className="rules-grid">
        <MoneyField label="Monthly budget" prefix={cur} value={form.monthlyBudget} onChange={(v) => set("monthlyBudget", v)} />
        <MoneyField label="Auto-pay up to" prefix={cur} value={form.autoApproveLimit} onChange={(v) => set("autoApproveLimit", v)} />
        <MoneyField label="Never allow above" prefix={cur} value={form.hardLimit} onChange={(v) => set("hardLimit", v)} />
        <MoneyField label="Max purchases a day" value={form.maxPurchasesPerDay} onChange={(v) => set("maxPurchasesPerDay", v)} />
        <label className="field wide">
          <span className="field-label">Allowed categories</span>
          <input value={form.allowedCategories} onChange={(e) => set("allowedCategories", e.target.value)} placeholder="Leave empty to allow anything" />
          <span className="hint">Comma separated, e.g. household, kitchen, book</span>
        </label>
        <label className="field wide">
          <span className="field-label">Never buy</span>
          <input value={form.blockedKeywords} onChange={(e) => set("blockedKeywords", e.target.value)} />
          <span className="hint">Blocks any product whose name or category contains these words</span>
        </label>
      </div>
      {dirty && (
        <div className="row-actions sticky-save">
          <button className="btn small dark" onClick={() => save(fromForm(form))}>
            Save changes
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

function MoneyField({ label, prefix, value, onChange }: { label: string; prefix?: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className={`input-wrap${prefix ? " has-prefix" : ""}`}>
        {prefix && <span className="prefix">{prefix}</span>}
        <input type="number" min={0} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
    </label>
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

function Empty({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <div className="empty">
      <span className="empty-ico">
        <Icon name={icon} />
      </span>
      <div>
        <div className="empty-title">{title}</div>
        <div className="empty-text">{text}</div>
      </div>
    </div>
  );
}

function Thumb({ src, icon = "bag" }: { src?: string; icon?: IconName }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="thumb">
      {src && !broken ? (
        // Product images come from many retailer domains, so a plain img is simplest here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <Icon name={icon} />
      )}
    </span>
  );
}

function SysDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`sys-item${ok ? " ok" : ""}`}>
      <span className="dot" /> {label}
    </span>
  );
}

function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      {/* An "L" whose foot ends in a leash ring */}
      <path d="M11.5 8v14h7" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22.5" cy="22" r="3" fill="none" stroke="#fff" strokeWidth="2.4" />
    </svg>
  );
}

function PayPalMark({ light = false }: { light?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="pp-mark">
      <path
        fill={light ? "#fff" : "#003087"}
        d="M8.3 21.2H4.6a.5.5 0 0 1-.5-.6L6.8 3.4A.8.8 0 0 1 7.6 2.7h6.1c3.3 0 5.4 1.7 4.9 4.9-.6 3.9-3.1 5.6-6.6 5.6H9.9a.8.8 0 0 0-.8.7z"
      />
      <path
        fill={light ? "rgba(255,255,255,.7)" : "#0070e0"}
        d="M19.3 8.2c-.6 3.6-3 5.6-6.6 5.6h-1.7a.8.8 0 0 0-.8.7l-1 6.4-.2 1.2a.5.5 0 0 0 .5.6h3.1a.7.7 0 0 0 .7-.6l.6-3.8a.7.7 0 0 1 .7-.6h.6c3 0 5.1-1.4 5.6-4.7.3-2-.4-3.4-1.5-4.8z"
      />
    </svg>
  );
}

type IconName =
  | "search" | "check" | "clock" | "ban" | "x" | "undo" | "sliders" | "wallet" | "alert" | "bot" | "mic" | "send"
  | "bag" | "inbox" | "activity" | "logout" | "reset" | "pause" | "sparkle" | "dot";

const PATHS: Record<IconName, string> = {
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.3-4.3",
  check: "M20 6 9 17l-5-5",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4.5V12l3 2",
  ban: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8",
  x: "M18 6 6 18M6 6l12 12",
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  wallet: "M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3v3a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5",
  alert: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  bot: "M12 8V4H8M4 8h16a0 0 0 0 1 0 0v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8zM2 14h2M20 14h2M9 13v2M15 13v2",
  mic: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z",
  bag: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  reset: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  pause: "M10 4H6v16h4zM18 4h-4v16h4z",
  sparkle: "M12 3l1.9 5.8L20 10.7l-6.1 1.9L12 18.5l-1.9-5.9L4 10.7l6.1-1.9z",
  dot: "M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
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
    // Near-silent recordings make the model invent words, so refuse them.
    let peak = 0;
    for (const v of pcm) peak = Math.max(peak, Math.abs(v));
    if (peak < 0.02) throw new Error("Couldn't hear you. Check that the right microphone is selected and not muted, then try again.");
    // Gently lift quiet recordings, but never more than 4x so background hiss isn't blown up.
    if (peak < 0.5) {
      const gain = Math.min(4, 0.7 / peak);
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

/** Shows the agent's **bold** text as bold and "* item" lines as bullets, instead of raw markdown. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.replace(/^[ \t]*[*-][ \t]+/gm, "• ").split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
      )}
    </>
  );
}

// Minimal types for the browser's speech recognition (Chrome/Edge/Safari).
type SpeechRecResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<SpeechRecResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecCtor = new () => SpeechRec;
