import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { env } from "./env.js";
import { log } from "./log.js";

export interface IncomingEmail {
  uid: number;
  messageId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  text: string;
  html: string | null;
}

function normalizeAddress(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(normalizeAddress).filter(Boolean).join(", ");
  const anyV = v as { text?: string; value?: unknown[] };
  if (typeof anyV.text === "string") return anyV.text;
  if (Array.isArray(anyV.value)) {
    return (anyV.value as Array<{ address?: string; name?: string }>)
      .map((x) =>
        x.address ? (x.name ? `${x.name} <${x.address}>` : x.address) : "",
      )
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

export type SeenMarker = (uid: number) => Promise<void>;

export interface PollResult {
  emails: IncomingEmail[];
  markSeen: SeenMarker;
  close: () => Promise<void>;
}

/**
 * Opens one IMAP connection, returns unread messages that match the To: filter,
 * plus helpers to flag them \\Seen or close the connection when done.
 * Caller must invoke close() in a finally-block.
 */
export async function pollUnseen(): Promise<PollResult> {
  const client = new ImapFlow({
    host: env.imap.host,
    port: env.imap.port,
    secure: env.imap.port === 993,
    auth: { user: env.imap.user, pass: env.imap.password },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock(env.imap.mailbox);
  const emails: IncomingEmail[] = [];

  try {
    const searchResult = await client.search({ seen: false }, { uid: true });
    const uids = Array.isArray(searchResult) ? searchResult : [];
    if (uids.length) {
      for (const uid of uids) {
        const fetched = await client.fetchOne(
          String(uid),
          { source: true, envelope: true },
          { uid: true },
        );
        if (!fetched || !fetched.source) continue;

        const parsed = await simpleParser(fetched.source);
        const to = normalizeAddress(parsed.to).toLowerCase();

        if (!to.includes(env.imap.toFilter.toLowerCase())) continue;

        const messageId = parsed.messageId ?? `uid-${uid}@${env.imap.mailbox}`;
        emails.push({
          uid: Number(uid),
          messageId,
          from: normalizeAddress(parsed.from),
          to,
          subject: parsed.subject ?? "",
          date: parsed.date?.toISOString() ?? new Date().toISOString(),
          text: parsed.text ?? "",
          html: parsed.html || null,
        });
      }
    }
  } catch (err) {
    lock.release();
    await client.logout().catch(() => undefined);
    log.error("IMAP fetch failed", { err: (err as Error).message });
    throw err;
  }

  const markSeen: SeenMarker = async (uid) => {
    await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
  };

  const close = async () => {
    lock.release();
    await client.logout().catch(() => undefined);
  };

  return { emails, markSeen, close };
}
