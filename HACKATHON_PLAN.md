# Leash: 4-day hackathon plan

**Deadline:** Thu Nov 12, 2026, 9:00pm (Lagos time). **Aim to submit by Thu 3:00pm.**

Prizes to target on the Devpost form: **Best Use of Agentic Commerce**, **Best Use of PayPal + AI**, **Most Creative**, **Best Use of Channel3**, **Best Use of Render**.

---

## Day 1: Sun Nov 8 (tonight): get it running

- [ ] Unzip, `npm install`, `npm run dev`, open http://localhost:3000. It works with no keys (demo mode).
- [ ] Create the GitHub repo `leash` (public), push. Add the MIT license in the About section (GitHub detects `LICENSE`).
- [ ] Get keys (≈20 min total):
  - [ ] PayPal sandbox app: developer.paypal.com → Apps & Credentials → Sandbox → Create App
  - [ ] Gemini key: aistudio.google.com/apikey (free)
  - [ ] Channel3 key: trychannel3.com (free tier)
- [ ] Put them in `.env.local`, restart. Check that the badges in the chat header turn blue.

## Day 2: Mon Nov 9: real PayPal and deploy

- [ ] Click **Connect PayPal wallet** → log in with your sandbox *personal* account → you come back with the "PayPal connected" banner.
  - If you get an error about vaulting, enable **Vault / Save payment methods** in your sandbox app settings. If that's still a problem, disconnect and use the one-time approval fallback (it still works).
- [ ] Buy something small → check the order shows up in the sandbox business account (sandbox.paypal.com).
- [ ] Try a refund.
- [ ] Deploy to Render (New → Blueprint). Set `APP_URL`. Reconnect PayPal on the live URL.
- [ ] Ask a friend to try the live link. Fix whatever confuses them.

## Day 3: Tue Nov 10: polish and one extra

Pick **one** extra, not all:
- [ ] Phone push with ntfy (5 min, just set `NTFY_TOPIC`), which gives the best moment for the video
- [ ] "Family mode": a second set of rules for a teen, with their own budget
- [ ] Weekly budget per category

Then:
- [ ] Try 10 different shopping requests with Channel3 on. Note anything odd (e.g. a category name that doesn't match your allowed list) and adjust the default allowed categories in `lib/policy.ts`.
- [ ] Update README: live URL, screenshot from the live app.

## Day 4: Wed Nov 11: video and write-up

- [ ] Record the demo video (script below). Keep it **under 3 minutes**. No copyrighted music.
- [ ] Upload to YouTube as **Public**.
- [ ] Fill in the Devpost form (draft below).

## Thu Nov 12: submit

- [ ] Final check: live URL works in an incognito window, repo is public, video is public, license visible.
- [ ] **Submit by 3pm.** Devpost slows down near the deadline.

---

## Demo video script (≈2:30)

**0:00 – 0:15 · The problem**
"AI agents can shop for us now. But would you give one your PayPal? One bad prompt and it buys a $300 gadget, or something you'd never allow. This is Leash."

**0:15 – 0:40 · Clip on the leash**
Click **Connect PayPal wallet** → PayPal sandbox approval → back to Leash. Then type in the rules box:
"$150 a month, groceries and household only, ask me for anything over $25, never alcohol." → **Draft rules** → **Apply**.
"The AI drafts my rules. I confirm. Then plain code enforces them, not the AI."

**0:40 – 1:30 · The money shot**
Type: **"Buy oat milk, coffee, an air fryer, red wine and headphones."**
Walk through the cards:
- Oat milk and coffee: green, **paid instantly with PayPal**.
- Air fryer: amber, needs approval. *(Phone buzzes, if ntfy is on.)*
- Wine: red, blocked: "matches a blocked item."
- Headphones: red, blocked for three reasons.

**1:30 – 1:55 · Human in the loop**
Click **Approve & pay** on the air fryer → it's paid. Show the PayPal order id in Purchases. Hit **Refund** on one item.

**1:55 – 2:15 · Why it's safe**
"The agent never decides. It can only ask, by product id. Price comes from the catalog, not the AI, so even a prompt-injected agent can't spend outside the rules." Click **Pause agent**, ask it to buy eggs → blocked: "kill switch is on."

**2:15 – 2:30 · Close**
"Leash: your AI shops, your rules hold. Built with PayPal Vault and Orders, Gemini, Channel3, and Render."

---

## Devpost write-up (draft)

**Tagline:** Your AI shops. Your rules hold. Spending guardrails for AI shopping agents, powered by PayPal.

**Inspiration**
Agentic commerce is coming fast, but the missing piece is trust. Nobody wants to hand an AI agent an open wallet. We wanted the same thing parents want with a kid's allowance: freedom inside clear limits.

**What it does**
Leash lets you connect your PayPal wallet once, set spending rules in plain English, and then let an AI agent shop for you. Every purchase the agent tries goes through a deterministic rules engine: small, allowed purchases are paid instantly with your saved PayPal wallet; bigger ones wait for your approval (with a phone notification); forbidden ones are blocked with a clear reason. There's a kill switch, one-tap refunds, and a full activity log.

**How we built it**
- PayPal Payment Method Tokens v3 (Vault) to save the user's wallet with their consent, and Orders v2 with `vault_id` so the agent can pay without the user present. Fallback to a standard approve-and-capture order. Refunds through Payments v2.
- An AI agent built with the Vercel AI SDK and Gemini, with three tools: search products, check budget, request purchase.
- Channel3's product API for real products across retailers.
- A rules engine in plain TypeScript with unit tests. The model passes only a product id; price and category come from the catalog, so the agent can't misreport them.
- Next.js, deployed on Render.

**Challenges**
Making sure the AI could never be the one deciding. We kept the rules out of the prompt entirely, so prompt injection in a product title can't change the outcome.

**Accomplishments**
A complete loop, from plain-English rules to an AI decision to a real PayPal sandbox payment to a refund, in a few days.

**What we learned**
How PayPal's vault flow enables "payer not present" payments, and why agentic commerce needs a policy layer between the agent and the money.

**What's next**
Multi-user accounts, family mode (a parent sets a teen's leash), per-merchant rules, and WhatsApp approvals.

**Built with:** paypal, paypal-vault, paypal-orders-api, gemini, vercel-ai-sdk, channel3, render, nextjs, typescript
