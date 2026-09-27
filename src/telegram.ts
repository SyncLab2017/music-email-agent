import { Telegraf, Markup } from "telegraf";
import type { Update } from "telegraf/types";
import { env, type ParsedEmail } from "./env.js";
import { log } from "./log.js";
import {
  attachTgMessage,
  getPending,
  markPendingStatus,
  setCooldown,
  type PendingRow,
} from "./dedup.js";
import { sendReply } from "./reply.js";

export const bot = new Telegraf(env.telegram.botToken);

function preview(text: string, max = 900): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function summaryLines(parsed: ParsedEmail, statusLine: string): string {
  const lines = [
    `<b>📨 Новая заявка</b>`,
    statusLine,
    parsed.contact_name ? `<b>Имя:</b> ${escapeHtml(parsed.contact_name)}` : "",
    parsed.artist_name ? `<b>Артист:</b> ${escapeHtml(parsed.artist_name)}` : "",
    parsed.email ? `<b>Email:</b> ${escapeHtml(parsed.email)}` : "",
    parsed.telegram ? `<b>TG:</b> ${escapeHtml(parsed.telegram)}` : "",
    parsed.city ? `<b>Город:</b> ${escapeHtml(parsed.city)}` : "",
    parsed.music_links ? `<b>Музыка:</b> ${escapeHtml(parsed.music_links)}` : "",
    parsed.references ? `<b>Референсы:</b> ${escapeHtml(parsed.references)}` : "",
    parsed.summary ? `\n${escapeHtml(parsed.summary)}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

/**
 * Post a summary card for every parsed email.
 * If `pending` is provided the card carries approve/reject buttons.
 * If not, it's a read-only info card (cooldown, no email extracted, etc.).
 */
export async function postSummary(input: {
  parsed: ParsedEmail;
  pending?: PendingRow;
  reason: "eligible" | "cooldown" | "no_email";
  cooldownUntil?: string | null;
}): Promise<void> {
  let statusLine: string;
  switch (input.reason) {
    case "eligible":
      statusLine = "🟢 Готов к ответу";
      break;
    case "cooldown": {
      const until = input.cooldownUntil
        ? new Date(input.cooldownUntil).toLocaleDateString("ru-RU")
        : "?";
      statusLine = `⏸ В cooldown до ${until} (недавно уже отвечали)`;
      break;
    }
    case "no_email":
      statusLine = "⚠️ Email автора не извлечён — ответить нельзя";
      break;
  }

  const body = summaryLines(input.parsed, statusLine);

  if (input.pending) {
    const card =
      body +
      `\n\n<b>Тема ответа:</b> ${escapeHtml(input.pending.subject)}` +
      `\n<b>Черновик:</b>\n<pre>${escapeHtml(preview(input.pending.text_body))}</pre>`;
    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Отправить", `approve:${input.pending.id}`),
        Markup.button.callback("❌ Отклонить", `reject:${input.pending.id}`),
      ],
    ]);
    const msg = await bot.telegram.sendMessage(env.telegram.approverChatId, card, {
      parse_mode: "HTML",
      ...kb,
      link_preview_options: { is_disabled: true },
    });
    await attachTgMessage(input.pending.id, msg.message_id);
    return;
  }

  // Read-only summary → summary channel (falls back to approver chat).
  await bot.telegram.sendMessage(env.telegram.summaryChatId, body, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

bot.on("callback_query", async (ctx) => {
  const cb = ctx.callbackQuery as { data?: string; message?: { message_id: number } };
  const data = cb.data ?? "";
  const [action, id] = data.split(":");
  if (!id || (action !== "approve" && action !== "reject")) {
    await ctx.answerCbQuery("bad payload");
    return;
  }

  const row = await getPending(id);
  if (!row) {
    await ctx.answerCbQuery("не найдено");
    return;
  }
  if (row.status !== "pending") {
    await ctx.answerCbQuery(`уже ${row.status}`);
    return;
  }

  if (action === "reject") {
    await markPendingStatus(id, "rejected");
    await ctx.answerCbQuery("отклонено");
    await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
    await ctx
      .reply(`❌ Отклонено: ${row.to_email}`, {
        reply_parameters: cb.message ? { message_id: cb.message.message_id } : undefined,
      })
      .catch(() => undefined);
    return;
  }

  // approve
  try {
    await sendReply({
      to: row.to_email,
      subject: row.subject,
      html: row.html,
      text: row.text_body,
    });
    await markPendingStatus(id, "sent");
    await setCooldown(row.to_email, env.reply.cooldownDays);
    await ctx.answerCbQuery("отправлено");
    await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
    await ctx
      .reply(`✅ Отправлено: ${row.to_email}`, {
        reply_parameters: cb.message ? { message_id: cb.message.message_id } : undefined,
      })
      .catch(() => undefined);
  } catch (err) {
    const msg = (err as Error).message;
    await markPendingStatus(id, "failed", { error: msg });
    log.error("send failed", { id, err: msg });
    await ctx.answerCbQuery("ошибка");
    await ctx.reply(`⚠️ Ошибка отправки ${row.to_email}: ${msg.slice(0, 300)}`);
  }
});

export async function handleWebhook(
  body: Update,
  secretHeader: string | undefined,
): Promise<void> {
  if (secretHeader !== env.telegram.webhookSecret) {
    throw new Error("invalid webhook secret");
  }
  await bot.handleUpdate(body);
}

export async function registerWebhook(publicUrl: string): Promise<void> {
  const url = `${publicUrl.replace(/\/+$/, "")}/tg/webhook`;
  await bot.telegram.setWebhook(url, {
    secret_token: env.telegram.webhookSecret,
    drop_pending_updates: true,
    allowed_updates: ["message", "callback_query"],
  });
  log.info("Telegram webhook set", { url });
}
