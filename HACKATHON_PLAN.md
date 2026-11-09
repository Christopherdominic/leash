# Leash: 4-day hackathon plan

**Deadline:** Thu Nov 12, 2026, 9:00pm (Lagos time). **Aim to submit by Thu 3:00pm.**

Prizes to target on the Devpost form: **Best Use of Agentic Commerce**, **Best Use of PayPal + AI**, **Most Creative**, **Best Use of Channel3**, **Best Use of Render**.

- **Live app:** https://leash-t86k.onrender.com
- **Repo:** https://github.com/Christopherdominic/leash
- **Phone alerts topic (ntfy):** see `NTFY_TOPIC` in `.env.local` (kept private)

---

## Day 1: Sun Nov 8: get it running ✅

- [x] `npm install`, `npm run dev`, app runs locally.
- [x] Keys: PayPal sandbox, Gemini, Channel3, all in `.env.local`.
- [x] Public GitHub repo `leash` with MIT license.

## Day 2: Mon Nov 9: real PayPal and deploy ✅

- [x] Connect PayPal wallet with a **US** sandbox Personal account. (Nigerian sandbox accounts can't save a wallet, so the app uses US Business + Personal test accounts.)
- [x] Buy something small, approve a bigger one, refund one.
- [x] Deployed to Render (Frankfurt, free plan). `APP_URL` and `NTFY_TOPIC` set.
- [ ] Check the orders show up in the US sandbox **Business** account at sandbox.paypal.com.
- [ ] Ask a friend to try the live link. Fix whatever confuses them.

## Day 3: Tue Nov 10: polish and extras ✅

- [x] Extra 1: **voice input** (mic button, transcribed by Gemini).
- [x] Extra 2: **phone alerts** with ntfy for approvals.
- [x] Tried 14 real shopping requests with Channel3. Fixed: agent now refuses look-alike products (Channel3 has no groceries, "oat milk" returns makeup); categories match whole words, so "home & garden" decor no longer sneaks through.
- [x] AI reliability: fast model first (Gemini 3.5 Flash-Lite), backups if Google is busy, 45s timeouts.
- [x] README: live URL and a screenshot from the live app.
- [ ] Optional: retake the README screenshot from the top of the page showing green, amber and red cards (can grab it while recording).

## Day 4: Wed Nov 11: video and write-up

- [ ] Record the demo video (script below). Keep it **under 3 minutes**. No copyrighted music.
- [ ] Upload to YouTube as **Public**. Paste the link into the README (`Video:` line) and Devpost.
- [ ] Fill in the Devpost form (draft below).

## Thu Nov 12: submit

- [ ] Final check: live URL works in an incognito window, repo is public, video is public, license visible.
- [ ] Open the live app ~10 minutes before judging windows if you can, so it isn't asleep.
- [ ] **Submit by 3pm.** Devpost slows down near the deadline.

---

## Before you hit record (5 min)

1. **Wake the app.** Render's free plan sleeps after 15 minutes and forgets everything. Open https://leash-t86k.onrender.com and wait for it to load.
2. **Reconnect PayPal** (incognito window, US Personal sandbox account).
3. Click **Reset demo** so the chat, purchases and budget are clean.
4. **Phone:** ntfy app open, subscribed to your topic, sound on, phone where the camera or screen recorder can show it (or hold it up to the webcam).
5. Browser zoom ~110% so text is readable on YouTube. Close other tabs. Turn off notifications from other apps.
6. Do one full practice run, then **Reset demo** again before the real take.

**Use these items.** Channel3 has household, kitchen, books, office and personal care, but **no groceries**. Don't say "oat milk" or "coffee" on camera.

| Say / type | What happens |
|---|---|
| paper towels, dish soap | ✅ Paid instantly (under $25) |
| air fryer | ⏸ Needs approval (~$80), phone buzzes |
| red wine | ⛔ Blocked: "wine" is a blocked keyword |
| headphones | ⛔ Blocked: electronics not allowed, over $120 |

---

## Demo video script (≈2:40)

**0:00 – 0:15 · The problem**
"AI agents can shop for us now. But would you hand one your PayPal? One bad prompt and it buys a $300 gadget, or something you'd never allow. This is Leash: your AI shops, your rules hold."

**0:15 – 0:40 · Clip on the leash**
Show the header: **PayPal connected** (sandbox account), and the three badges: **Gemini · Channel3 catalog · PayPal sandbox**.
"I connected my PayPal wallet once, using PayPal's Vault. Now the agent can pay without me, but only inside my rules."
Type in the rules box: *"$150 a month, household, kitchen and books only, ask me for anything over $25, never alcohol."* → **Draft rules** → **Apply**.
"The AI drafts my rules. I confirm them. Then plain code enforces them, not the AI."

**0:40 – 1:35 · The money shot (use your voice)**
Click the **mic** and say: **"Buy paper towels, dish soap, an air fryer, red wine and headphones."** Click the mic again, show the words appear, press **Send**.
"I can just talk to it." Walk through the cards as they appear:
- Paper towels and dish soap: green, **paid instantly with PayPal**. Point at the real PayPal order id under Purchases.
- Air fryer: amber, needs approval. **Show your phone buzzing** with the Leash alert.
- Red wine: red, blocked: "matches a blocked item."
- Headphones: red, blocked for more than one reason.

**1:35 – 2:00 · Human in the loop**
Click **Approve & pay** on the air fryer → it's paid. "A human approval turns 'ask' into 'allow', but it can never override a block." Hit **Refund** on one item → **Refunded**.

**2:00 – 2:25 · Why it's safe**
"The agent never decides. It can only ask to buy a product id. The price and category come from the catalog, not from the AI, so even a hijacked agent can't spend outside the rules. And if a search returns the wrong thing, like makeup when you asked for oat milk, the agent refuses instead of buying it."
Click **Pause agent**, ask it to buy dish soap → blocked: "kill switch is on."

**2:25 – 2:40 · Close**
"Leash: your AI shops, your rules hold. Built with PayPal Vault, Orders and Refunds, Gemini, Channel3, and deployed on Render."

**If something goes wrong on camera:** keep going if it's small. If Gemini is slow, cut the wait in editing. If PayPal shows an error, reconnect and redo that segment; you can splice clips.

---

## Devpost write-up (draft)

**Tagline:** Your AI shops. Your rules hold. Spending guardrails for AI shopping agents, powered by PayPal.

**Try it:** https://leash-t86k.onrender.com · **Code:** https://github.com/Christopherdominic/leash

**Inspiration**
Agentic commerce is coming fast, but the missing piece is trust. Nobody wants to hand an AI agent an open wallet. We wanted what parents want with a kid's allowance: freedom inside clear limits.

**What it does**
Leash lets you connect your PayPal wallet once, set spending rules in plain English, and then let an AI agent shop for you, by typing or just by talking. Every purchase the agent tries goes through a deterministic rules engine:
- Small, allowed purchases are paid instantly with your saved PayPal wallet.
- Bigger ones wait in your approval inbox, and your phone buzzes.
- Forbidden ones are blocked with a clear reason.

There's a kill switch, one-tap refunds, and a full activity log of every search, decision and payment.

**How we built it**
- **PayPal:** Payment Method Tokens v3 (Vault) to save the user's wallet with their consent; Orders v2 with `vault_id` so the agent can pay with the user not present; a standard approve-and-capture order as fallback; Payments v2 refunds; deleting the payment token on disconnect revokes the agent's access.
- **AI agent:** Vercel AI SDK with Google Gemini and three tools: search products, check budget, request purchase. It starts on a fast model (Gemini 3.5 Flash-Lite) and falls back to larger models if one is overloaded, with timeouts so the app never hangs.
- **Channel3:** real products across retailers, with prices and categories from Channel3, not from the model.
- **Rules engine:** plain TypeScript with unit tests. The model passes only a product id; price and category come from the server-side catalog cache, so the agent can't misreport them.
- **Voice input:** the browser records your request, converts it to WAV, and Gemini transcribes it. You review the words before sending, because a misheard word shouldn't spend money.
- **Phone alerts:** ntfy push notifications for anything that needs approval.
- **Next.js 16**, deployed on **Render**.

**Challenges**
- Making sure the AI could never be the one deciding. The rules live in code, not in the prompt, so a prompt injection in a product title can't change the outcome.
- Real catalogs are messy. Searching "oat milk" returned an oat milk *makeup foundation*. We taught the agent to refuse look-alike products, and tightened category matching to whole words after "home & garden" decor slipped past a "home" rule.
- PayPal's sandbox mirrors country rules: our Nigerian sandbox accounts couldn't save a wallet, so we set up US sandbox accounts.
- Gemini capacity spikes: a single overloaded model could stall the agent for minutes, so we added model fallbacks and timeouts.

**Accomplishments**
A complete, deployed loop in four days, from plain-English (or spoken) rules, to an AI shopping decision, to a real PayPal sandbox payment, to a phone approval, to a refund.

**What we learned**
How PayPal's Vault enables "payer not present" payments, and why agentic commerce needs a policy layer between the agent and the money that the agent can't talk its way around.

**What's next**
Multi-user accounts and a database, family mode (a parent sets a teen's leash), weekly budgets per category, per-merchant rules, and WhatsApp approvals.

**Built with:** paypal, paypal-vault, paypal-orders-api, gemini, vercel-ai-sdk, channel3, render, nextjs, typescript, ntfy, web-audio-api
