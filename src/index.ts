import express from "express";
import type { Request, Response } from "express";
import { env } from "./env.js";
import { log } from "./log.js";
import { pollUnseen, type IncomingEmail } from "./imap.js";
import { parseEmail } from "./parse.js";
import { appendRow } from "./sheets.js";
import { buildReply } from "./build-reply.js";
import {
  createPending,
  getCooldownUntil,
  isProcessed,
  markProcessed,
} from "./dedup.js";
import {
  bot,
  handleWebhook,
  postSummary,
  registerWebhook,
} from "./telegram.js";
import { verifySmtp } from "./reply.js";

let cycleInFlight = false;
let stopping = false;

async function handleOne(mail: IncomingEmail): Promise<void> {
  if (await isProcessed(mail.messageId)) {
    log.info("skip: already processed", { messageId: mail.messageId });
    return;
  }

  let parsed;
  try {
    parsed = await parseEmail({
      from: mail.from,
      subject: mail.subject,
      date: mail.date,
      text: mail.text || mail.html || "",
    });
  } catch (err) {
    log.error("parse failed", {
      uid: mail.uid,
      err: (err as Error).message,
    });
    return; // leave UNSEEN so we retry next cycle
  }

  try {
    await appendRow(parsed);
  } catch (err) {
    log.error("sheets append failed", {
      uid: mail.uid,
      err: (err as Error).message,
    });
    return; // leave UNSEEN
  }

  await markProcessed(mail.messageId, parsed.email ?? null, parsed);

  const draft = buildReply({
    parsed,
    originalSubject: mail.subject || "Ваша заявка",
  });

  if (!draft || !parsed.email) {
    await postSummary({ parsed, reason: "no_email" }).catch((err) =>
      log.error("summary post failed", { err: (err as Error).message }),
    );
    return;
  }

  const cooldownUntil = await getCooldownUntil(parsed.email);
  const stillCooling =
    cooldownUntil && new Date(cooldownUntil).getTime() > Date.now();

  if (stillCooling) {
    await postSummary({
      parsed,
      reason: "cooldown",
      cooldownUntil,
    }).catch((err) =>
      log.error("summary post failed", { err: (err as Error).message }),
    );
    return;
  }

  const row = await createPending({
    messageId: mail.messageId,
    toEmail: parsed.email,
    subject: draft.subject,
    html: draft.html,
    text: draft.text,
    parsed,
  });

  try {
    await postSummary({ parsed, pending: row, reason: "eligible" });
  } catch (err) {
    log.error("telegram card failed", {
      id: row.id,
      err: (err as Error).message,
    });
  }
}

async function cycle(): Promise<void> {
  if (cycleInFlight || stopping) return;
  cycleInFlight = true;
  const started = Date.now();

  try {
    const poll = await pollUnseen();
    try {
      if (poll.emails.length) {
        log.info("cycle: emails found", { count: poll.emails.length });
      }
      for (const mail of poll.emails) {
        try {
          await handleOne(mail);
          await poll.markSeen(mail.uid);
        } catch (err) {
          log.error("handle failed", {
            uid: mail.uid,
            err: (err as Error).message,
          });
        }
      }
    } finally {
      await poll.close();
    }
  } catch (err) {
    log.error("cycle error", { err: (err as Error).message });
  } finally {
    cycleInFlight = false;
    log.info("cycle done", { ms: Date.now() - started });
  }
}

async function main(): Promise<void> {
  log.info("music-email-agent starting");

  // Kick off SMTP verify in the background — Yandex handshake can be slow and
  // must not block HTTP listener / Telegram webhook registration.
  verifySmtp()
    .then(() => log.info("SMTP verify ok"))
    .catch((err) =>
      log.warn("SMTP verify failed at boot", { err: (err as Error).message }),
    );

  const app = express();
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, cycleInFlight, stopping });
  });

  app.post("/tg/webhook", (req: Request, res: Response) => {
    const secret = req.get("x-telegram-bot-api-secret-token");
    if (secret !== env.telegram.webhookSecret) {
      res.sendStatus(403);
      return;
    }
    // Ack immediately — Telegram times out at ~5s and callback handlers
    // (SMTP send, etc.) can run much longer.
    res.sendStatus(200);
    handleWebhook(req.body, secret).catch((err) =>
      log.error("webhook handler error", { err: (err as Error).message }),
    );
  });

  app.listen(env.server.port, () => {
    log.info(`http listening on :${env.server.port}`);
  });

  if (env.server.publicUrl) {
    await registerWebhook(env.server.publicUrl).catch((err) =>
      log.warn("webhook registration failed", { err: (err as Error).message }),
    );
  } else {
    log.warn("PUBLIC_URL not set; skipping webhook registration");
  }

  await cycle();
  const timer = setInterval(cycle, env.imap.pollIntervalMs);

  const shutdown = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`shutdown: ${sig}`);
    clearInterval(timer);
    bot.stop(sig);
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("fatal", { err: (err as Error).message });
  process.exit(1);
});
