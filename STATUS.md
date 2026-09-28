# Music Email Agent — Live Status

**Status:** 🟢 Deployed and operating in production
**Live URL:** https://music-email-agent-production.up.railway.app
**Last verified:** 2026-09-28

## What it does

Replaces the old n8n workflow that watched `music@synclab.pro`. Every 2 minutes:

1. IMAP polls the `Music e-mail` folder on `denis@synclab.pro` (Yandex catch-all captures anything sent to `*@synclab.pro`).
2. Emails whose `To:` contains `music@synclab.pro` are parsed by DeepSeek (`deepseek-chat`, JSON mode).
3. The parsed row is appended to the `Music Base 2026` Google Sheet.
4. A summary card is posted to Telegram bot `@SyncLab_bot`:
   - 🟢 **Готов к ответу** — action buttons ✅ / ❌.
   - ⏸ **В cooldown до YYYY-MM-DD** — same sender was replied to within `REPLY_COOLDOWN_DAYS` (30).
   - ⚠️ **Email не извлечён** — parse could not find a return address.
5. `Message-ID` is recorded so restarts don't double-write to the sheet.
6. On approve, the reply is sent via Resend HTTP API from `denis@synclab.pro`, with BCC to `denis@synclab.pro` (so a copy lands in the Yandex inbox — filter to move into a "Sent-Bot" folder if desired).

## Architecture

```
Yandex IMAP  →  Railway container (Node 22-alpine)  →  Resend HTTP  →  recipient
                       │
                       ├── DeepSeek chat API
                       ├── Google Sheets (Service Account)
                       ├── Telegram Bot API (webhook)
                       └── SQLite state on Railway volume (/data/state.db)
```

- **Runtime:** Node 22 with `--experimental-sqlite` (see `Dockerfile`).
- **Language:** TypeScript executed by `tsx` (no build step).
- **Region:** Railway EU West (Amsterdam). Southeast Asia was the first pick but Yandex handshakes there were slow; the swap dropped cycle time from ~5s to ~1.5s.
- **State store:** SQLite file on a Railway persistent volume mounted at `/data`. Three tables — `processed`, `cooldown`, `pending` — created inline at boot.

## Why Resend, not SMTP

Yandex refuses all SMTP connections (both `465/SSL` and `587/STARTTLS`) from Railway egress IPs — they time out silently. Yandex uses IP reputation lists and cloud provider blocks. Nodemailer therefore couldn't deliver from any region. Resend uses HTTPS and works from any cloud; `synclab.pro` is DKIM/SPF/DMARC-verified inside Resend so recipients still see a properly signed message from `denis@synclab.pro`.

Trade-off: replies never touch the Yandex outbound server, so they don't appear in Yandex's "Sent" folder. Workaround wired up: **every reply BCCs `denis@synclab.pro`**, so a copy always lands in the inbox.

## Repository layout

```
Email_to_base/
├── Dockerfile              # node:22-alpine, npm install prod deps, tsx runtime
├── railway.json            # health check /health
├── package.json            # tsx + tsc, no build step
├── src/
│   ├── index.ts            # main loop, express health + TG webhook
│   ├── env.ts              # env parsing + Zod schema for parsed emails
│   ├── log.ts              # simple JSON-ish stderr logger
│   ├── imap.ts             # imapflow + mailparser, one connection per cycle
│   ├── parse.ts            # DeepSeek chat call, date normalisation
│   ├── sheets.ts           # googleapis Service Account, append to Music Base 2026
│   ├── dedup.ts            # node:sqlite state (processed / cooldown / pending)
│   ├── build-reply.ts      # HTML + text template
│   ├── reply.ts            # POST https://api.resend.com/emails (with BCC)
│   └── telegram.ts         # telegraf, summary cards + approve/reject webhook
└── STATUS.md               # this file
```

## Live infrastructure

| Thing | Value |
|---|---|
| Railway project | `energetic-wonder` (id `6007111d-0ef7-40f5-81e8-d07a856b2f51`) |
| Service | `music-email-agent` |
| Environment | `production` |
| Region | EU West (Amsterdam) |
| Public URL | https://music-email-agent-production.up.railway.app |
| Health check | `GET /health` → `{ok:true,cycleInFlight,stopping}` |
| Telegram webhook | `POST /tg/webhook` (secret in `x-telegram-bot-api-secret-token`) |
| Persistent volume | `/data` — 5 GB, mount id `c3eb5a88-cb12-4680-83d6-53e0d665be1a` |
| SQLite path | `/data/state.db` |
| GitHub repo | https://github.com/SyncLab2017/music-email-agent (public) |

## Environment variables

All set via Railway → `music-email-agent` service → Variables.

```
IMAP_HOST=imap.yandex.ru
IMAP_PORT=993
IMAP_USER=denis@synclab.pro
IMAP_PASSWORD=<Yandex app password>
IMAP_MAILBOX=Music e-mail
IMAP_TO_FILTER=music@synclab.pro
POLL_INTERVAL_MS=120000

SMTP_FROM_NAME=Denis Sharko | Synclab
SMTP_FROM_EMAIL=denis@synclab.pro

RESEND_API_KEY=<re_... — see Resend → API keys>
RESEND_BCC=denis@synclab.pro

DEEPSEEK_API_KEY=<sk-... — see DeepSeek platform>
DEEPSEEK_MODEL=deepseek-chat

GOOGLE_SERVICE_ACCOUNT_JSON=<full JSON on one line, private_key `\n` normalised>
GOOGLE_SHEET_ID=1SsJvaPwWFasHbgGWYU6R6DA-TZx6ALDC_xbfpbcENfA
GOOGLE_SHEET_TAB=Лист1

TG_BOT_TOKEN=5955303362:AAEE_V9_1XUcvX1eA0YPRz4gAUPYsHOnZE0    # rotate via @BotFather!
TG_APPROVER_CHAT_ID=418128398
TG_WEBHOOK_SECRET=<64-char hex>

PORT=8080
PUBLIC_URL=https://music-email-agent-production.up.railway.app
REPLY_COOLDOWN_DAYS=30
SQLITE_PATH=/data/state.db
```

## External accounts / services

| Service | Purpose | How it's linked |
|---|---|---|
| Yandex 360 (`denis@synclab.pro`) | IMAP source | App password in `IMAP_PASSWORD`. Yandex catch-all forwards `*@synclab.pro` → this inbox. |
| Google Cloud project `gen-lang-client-0237345550` (YaParsing) | Sheets API + Service Account | Sheets API enabled; SA `music-email-agent@gen-lang-client-0237345550.iam.gserviceaccount.com` shared as **Editor** on `Music Base 2026`. |
| Telegram bot `@SyncLab_bot` | Approval UX | Webhook `/tg/webhook`; `allowed_updates=["message","callback_query"]`. |
| DeepSeek Platform | Parser LLM | API key created 2026-09-27. |
| Resend | Outbound mail | Domain `synclab.pro` verified (DKIM/SPF/DMARC). Send-only API key. |

## Reply template

```
Привет, <first name>!

Спасибо <artist or name>, за письмо. Материалы сохраним для будущих проектов.

Чтобы не было в будущем недоразумений, уточните, пожалуйста:

Каков статус по правам в присланных вами произведениях?
(эксклюзив / неэксклюзив, есть ли издатель или лейбл?)

Пока — загляните в наш каталог для sync-лицензирования: syncoteca.pro.

И если интересна изнанка индустрии — есть наша книга
«Музыкальный продюсер в кино», доступна на сайте ЭКСМО.

---
Instagram · Telegram · Denis Sharko · Synclab · denis@synclab.pro
```

Handled entirely in `src/build-reply.ts`. Every reply always contains the `syncoteca.pro` link and the ЭКСМО book link.

## Operational notes

- `git push main` on GitHub triggers a Railway rebuild automatically.
- Env changes in Railway trigger a rebuild automatically.
- Boot log will show `WARN SMTP verify failed at boot` only if we ever restore an outbound-SMTP path — the current build has `verifySmtp()` as a no-op.
- **State backup:** `railway run cat /data/state.db > state-backup.db` (or use `railway volume browse`).
- **Old n8n workflow** should be disabled — Denis to confirm.

## Known limitations / follow-ups

- **Cooldown default 30 days.** Change via `REPLY_COOLDOWN_DAYS` env.
- **Bot rotation:** `@SyncLab_bot` token was pasted in chat and Git history — plan a rotation once the workflow stabilises (`@BotFather` → `/revoke`).
- **Sheet is world-editable** (`Все, у кого есть ссылка` = Editor). Tighten if desired.
- **No retries on Resend failure.** Failed sends land as `status=failed` in the `pending` table; a manual re-approve would need a fresh email today.
- **Loopback safety.** Because `music@` catch-alls to `denis@`, replying to a `denis@synclab.pro` sender is technically possible; DeepSeek generally extracts the true reply address from forwarded headers, but this is worth watching.

## Recent history

| Date | Event |
|---|---|
| 2026-09-27 | Repo scaffolded, deployed to Railway (Southeast Asia). First test email round-tripped through IMAP → DeepSeek → Sheets → Telegram card. |
| 2026-09-27 | Webhook `allowed_updates` fix: `callback_query` was missing so buttons didn't fire. |
| 2026-09-27 | Webhook handler now `res.sendStatus(200)` immediately, work runs async (Telegram's 5 s read timeout was retrying handlers). |
| 2026-09-27 | Region migrated to EU West. |
| 2026-09-28 | Yandex SMTP confirmed to blackhole Railway egress. Migrated outbound to Resend HTTP API with `synclab.pro` domain verified (DKIM/SPF/DMARC), BCC to `denis@synclab.pro`. |
| 2026-09-28 | Reply template shortened: dropped the "questions" list, kept a single rights clarification + `syncoteca.pro` + ЭКСМО link. |
