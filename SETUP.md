# Music Email Agent — setup

Standalone Node.js service that replaces the n8n workflow:

`IMAP poll → DeepSeek parse → Google Sheets append → Telegram approval → SMTP reply`

State (dedup / cooldown / pending approvals) lives in a single SQLite file on a Railway persistent volume. No external database.

## 1. Railway service + persistent volume

1. Push this folder to a GitHub repo (see step 5 below).
2. Railway dashboard → New Project → Deploy from GitHub → pick the repo.
3. The first deploy will fail with `Missing env: IMAP_HOST` — that's expected. Fill env vars in the next steps.
4. Service → **Settings → Volumes → New Volume**. Mount path: `/data`. Any size (1 GB is more than enough — state grows by ~1 KB per email).
5. Service → **Settings → Networking → Generate Domain**. Copy the `https://...up.railway.app` URL — you'll paste it into `PUBLIC_URL` env.

You don't have to interact with the volume. It's mounted at `/data` inside the container and holds `state.db`. If you ever need a backup:
```
railway run cat /data/state.db > state-backup.db
```

## 2. Google Sheets Service Account

1. Google Cloud Console → new/existing project → APIs & Services → enable **Google Sheets API**.
2. Credentials → Create credentials → Service Account.
3. Under the account → Keys → Add key → JSON. Download.
4. Open the target sheet `Music Base 2026` → Share → paste the service account email (`...@...iam.gserviceaccount.com`) → **Editor**. No email notification.
5. Copy the entire JSON. Paste it into `GOOGLE_SERVICE_ACCOUNT_JSON` as-is (single-line works — the loader normalises `\n` in the private key). Base64 is also accepted if Railway UI mangles quotes.

## 3. Telegram bot

Using `@SyncLab_bot` (token `5955303362:...`) and your private chat id `418128398`.

- `TG_BOT_TOKEN=5955303362:...`
- `TG_APPROVER_CHAT_ID=418128398` — cards with buttons land here
- `TG_SUMMARY_CHAT_ID=` — leave empty (same chat handles both)
- `TG_WEBHOOK_SECRET=<random hex, ≥32 chars>` — any random string; Telegram echoes it back and we reject anything else

⚠️ The bot token above already ran through this chat. After the service is up and stable, rotate it: `@BotFather` → `/revoke` → new token → replace in Railway env.

## 4. IMAP + SMTP + DeepSeek

Reuse the same credentials as the old n8n workflow:

- `IMAP_HOST=imap.yandex.ru`, `IMAP_PORT=993`, `IMAP_USER=music@synclab.pro`, `IMAP_PASSWORD=<yandex app password>`, `IMAP_MAILBOX=Music e-mail`, `IMAP_TO_FILTER=music@synclab.pro`
- `SMTP_HOST=smtp.yandex.ru`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=sync@synclab.pro`, `SMTP_PASSWORD=<yandex app password>`, `SMTP_FROM_NAME=Synclab Pro`, `SMTP_FROM_EMAIL=sync@synclab.pro`
- `DEEPSEEK_API_KEY=<sk-...>`
- `GOOGLE_SHEET_ID=1SsJvaPwWFasHbgGWYU6R6DA-TZx6ALDC_xbfpbcENfA`, `GOOGLE_SHEET_TAB=Лист1`
- `PORT=8080`, `PUBLIC_URL=https://<your-service>.up.railway.app`
- `REPLY_COOLDOWN_DAYS=30`

Paste all of the above into Railway → Variables. Railway will auto-redeploy.

## 5. Push to GitHub + first deploy

```
cd /Users/synclabpro/Projects/Email_to_base
git init
git add .
git commit -m "init music email agent"
gh repo create SyncLab2017/music-email-agent --private --source=. --push
```

Then link that repo in Railway → deploy → wait for the log line `Telegram webhook set` → the service is live.

## 6. Turn off n8n

Once you see one full cycle in Railway logs (`cycle done` with a real `count`), disable the old n8n workflow so both don't fire.

## Local development

```
cp .env.example .env
# fill values, set SQLITE_PATH=./data/state.db
npm install
npm run dev
```

`PUBLIC_URL` empty ⇒ webhook not registered. For local Telegram testing use `ngrok http 8080` and set `PUBLIC_URL=https://<sub>.ngrok-free.app`.

## Behaviour notes

- Reply is **never** auto-sent. Every new sender gets a card in Telegram; you click ✅ or ❌.
- Every parsed email lands as a summary in Telegram, three states in the card header:
  - 🟢 **Готов к ответу** — buttons present.
  - ⏸ **В cooldown до <дата>** — same author already replied recently; read-only.
  - ⚠️ **Email не извлечён** — parse couldn't find a return address; read-only.
- Reply template always includes a link to `syncoteca.pro` and to the book on ЭКСМО.
- After ✅ the sender enters a `REPLY_COOLDOWN_DAYS` cooldown (default 30) — new letters still get parsed and appended to Sheets, and land in the channel with ⏸.
- Message-ID dedup means the service is safe to restart: already-processed IMAP UIDs won't be double-appended to Sheets.
- IMAP filter: only messages with `To:` containing `music@synclab.pro` are handled — others stay `UNSEEN` untouched.
