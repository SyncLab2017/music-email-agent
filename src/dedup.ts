import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { env, type ParsedEmail } from "./env.js";

const dir = path.dirname(env.sqlite.path);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new DatabaseSync(env.sqlite.path);
db.exec("pragma journal_mode = WAL");
db.exec("pragma foreign_keys = ON");

db.exec(`
  create table if not exists processed (
    message_id text primary key,
    processed_at text not null default (datetime('now')),
    to_email text,
    parsed_json text
  );

  create table if not exists cooldown (
    email text primary key,
    until_ts text not null,
    last_reply_at text not null default (datetime('now'))
  );
  create index if not exists cooldown_until_idx on cooldown(until_ts);

  create table if not exists pending (
    id text primary key,
    message_id text not null,
    to_email text not null,
    subject text not null,
    html text not null,
    text_body text not null,
    parsed_json text not null,
    tg_message_id integer,
    status text not null default 'pending',
    created_at text not null default (datetime('now')),
    decided_at text,
    sent_at text,
    error text
  );
  create index if not exists pending_status_idx on pending(status, created_at desc);
`);

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const stmts = {
  isProcessed: db.prepare(
    "select message_id from processed where message_id = ?",
  ),
  insertProcessed: db.prepare(
    "insert or replace into processed(message_id, to_email, parsed_json) values (?, ?, ?)",
  ),
  getCooldown: db.prepare("select until_ts from cooldown where email = ?"),
  upsertCooldown: db.prepare(
    "insert into cooldown(email, until_ts, last_reply_at) values (?, ?, datetime('now')) " +
      "on conflict(email) do update set until_ts = excluded.until_ts, last_reply_at = datetime('now')",
  ),
  insertPending: db.prepare(
    "insert into pending(id, message_id, to_email, subject, html, text_body, parsed_json) " +
      "values (:id, :message_id, :to_email, :subject, :html, :text_body, :parsed_json)",
  ),
  getPending: db.prepare("select * from pending where id = ?"),
  attachTgMessage: db.prepare(
    "update pending set tg_message_id = ? where id = ?",
  ),
  updateStatus: db.prepare(
    "update pending set status = :status, decided_at = :decided_at, sent_at = :sent_at, error = :error where id = :id",
  ),
};

interface PendingRowRaw {
  id: string;
  message_id: string;
  to_email: string;
  subject: string;
  html: string;
  text_body: string;
  parsed_json: string;
  tg_message_id: number | null;
  status: string;
  created_at: string;
  decided_at: string | null;
  sent_at: string | null;
  error: string | null;
}

export interface PendingRow {
  id: string;
  message_id: string;
  to_email: string;
  subject: string;
  html: string;
  text_body: string;
  parsed: ParsedEmail;
  tg_message_id: number | null;
  status: string;
}

function hydrate(row: PendingRowRaw): PendingRow {
  return {
    id: row.id,
    message_id: row.message_id,
    to_email: row.to_email,
    subject: row.subject,
    html: row.html,
    text_body: row.text_body,
    parsed: JSON.parse(row.parsed_json) as ParsedEmail,
    tg_message_id: row.tg_message_id,
    status: row.status,
  };
}

export async function isProcessed(messageId: string): Promise<boolean> {
  return !!stmts.isProcessed.get(messageId);
}

export async function markProcessed(
  messageId: string,
  toEmail: string | null,
  parsed: ParsedEmail,
): Promise<void> {
  stmts.insertProcessed.run(messageId, toEmail, JSON.stringify(parsed));
}

export async function getCooldownUntil(email: string): Promise<string | null> {
  const row = stmts.getCooldown.get(email.toLowerCase()) as
    | { until_ts: string }
    | undefined;
  return row?.until_ts ?? null;
}

export async function isInCooldown(email: string): Promise<boolean> {
  const until = await getCooldownUntil(email);
  return !!until && new Date(until).getTime() > Date.now();
}

export async function setCooldown(email: string, days: number): Promise<void> {
  const until = new Date(Date.now() + days * 86_400_000).toISOString();
  stmts.upsertCooldown.run(email.toLowerCase(), until);
}

export async function createPending(input: {
  messageId: string;
  toEmail: string;
  subject: string;
  html: string;
  text: string;
  parsed: ParsedEmail;
}): Promise<PendingRow> {
  const id = uuid();
  stmts.insertPending.run({
    id,
    message_id: input.messageId,
    to_email: input.toEmail,
    subject: input.subject,
    html: input.html,
    text_body: input.text,
    parsed_json: JSON.stringify(input.parsed),
  });
  const raw = stmts.getPending.get(id) as PendingRowRaw | undefined;
  if (!raw) throw new Error("pending insert failed");
  return hydrate(raw);
}

export async function attachTgMessage(
  pendingId: string,
  tgMessageId: number,
): Promise<void> {
  stmts.attachTgMessage.run(tgMessageId, pendingId);
}

export async function getPending(id: string): Promise<PendingRow | null> {
  const raw = stmts.getPending.get(id) as PendingRowRaw | undefined;
  return raw ? hydrate(raw) : null;
}

export async function markPendingStatus(
  id: string,
  status: "approved" | "rejected" | "sent" | "failed",
  extra: { error?: string } = {},
): Promise<void> {
  stmts.updateStatus.run({
    id,
    status,
    decided_at: new Date().toISOString(),
    sent_at: status === "sent" ? new Date().toISOString() : null,
    error: extra.error ?? null,
  });
}
