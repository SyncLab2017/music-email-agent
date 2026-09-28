import { env } from "./env.js";

interface ResendSendResponse {
  id?: string;
  message?: string;
  name?: string;
}

export async function sendReply(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.resend.apiKey}`,
    },
    body: JSON.stringify({
      from: `${env.smtp.fromName} <${env.smtp.fromEmail}>`,
      to: [input.to],
      bcc: env.resend.bcc ? [env.resend.bcc] : undefined,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as ResendSendResponse;

  if (!res.ok || !json.id) {
    const msg = json.message || json.name || `HTTP ${res.status}`;
    throw new Error(`Resend: ${msg}`);
  }
}

export async function verifySmtp(): Promise<void> {
  // Resend has no long-lived connection; a HEAD on domains is enough
  // to confirm the key is accepted.
  const res = await fetch("https://api.resend.com/domains", {
    headers: { authorization: `Bearer ${env.resend.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Resend auth check: HTTP ${res.status}`);
  }
}
