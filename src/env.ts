import { z } from "zod";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function loadServiceAccount(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const jsonStr = trimmed.startsWith("{")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8");
  const parsed = JSON.parse(jsonStr);
  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  return parsed;
}

export const env = {
  imap: {
    host: requireEnv("IMAP_HOST"),
    port: Number(process.env.IMAP_PORT ?? 993),
    user: requireEnv("IMAP_USER"),
    password: requireEnv("IMAP_PASSWORD"),
    mailbox: process.env.IMAP_MAILBOX ?? "INBOX",
    toFilter: process.env.IMAP_TO_FILTER ?? requireEnv("IMAP_USER"),
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 120_000),
  },
  smtp: {
    fromName: process.env.SMTP_FROM_NAME ?? "Synclab Pro",
    fromEmail: requireEnv("SMTP_FROM_EMAIL"),
  },
  deepseek: {
    apiKey: requireEnv("DEEPSEEK_API_KEY"),
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  },
  google: {
    serviceAccount: loadServiceAccount(requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON")),
    sheetId: requireEnv("GOOGLE_SHEET_ID"),
    sheetTab: process.env.GOOGLE_SHEET_TAB ?? "Лист1",
  },
  sqlite: {
    path: process.env.SQLITE_PATH ?? "/data/state.db",
  },
  resend: {
    apiKey: requireEnv("RESEND_API_KEY"),
    bcc: process.env.RESEND_BCC?.trim() || null,
  },
  telegram: (() => {
    const approver = requireEnv("TG_APPROVER_CHAT_ID");
    return {
      botToken: requireEnv("TG_BOT_TOKEN"),
      approverChatId: approver,
      summaryChatId: process.env.TG_SUMMARY_CHAT_ID?.trim() || approver,
      webhookSecret: requireEnv("TG_WEBHOOK_SECRET"),
    };
  })(),
  server: {
    port: Number(process.env.PORT ?? 8080),
    publicUrl: process.env.PUBLIC_URL ?? "",
  },
  reply: {
    cooldownDays: Number(process.env.REPLY_COOLDOWN_DAYS ?? 30),
  },
};

export const ParsedEmailSchema = z.object({
  date: z.string().nullable().optional(),
  contact_name: z.string().nullable().optional(),
  artist_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  telegram: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  music_links: z.string().nullable().optional(),
  other_links: z.string().nullable().optional(),
  references: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
});

export type ParsedEmail = z.infer<typeof ParsedEmailSchema>;
