import type { ParsedEmail } from "./env.js";

export interface DraftReply {
  subject: string;
  html: string;
  text: string;
}

function firstName(full: string | null | undefined): string {
  if (!full) return "";
  return full.trim().split(/\s+/)[0] ?? "";
}

export function buildReply(input: {
  parsed: ParsedEmail;
  originalSubject: string;
}): DraftReply | null {
  const email = input.parsed.email;
  if (!email) return null;

  const name = firstName(input.parsed.contact_name) || "друзья";
  const artist = input.parsed.artist_name?.trim();
  const thanksSubject =
    artist && artist !== input.parsed.contact_name ? artist : name;

  const subject = "Re: " + input.originalSubject.replace(/^Re:\s*/i, "");

  const html = `<p>Привет, ${name}!</p>

<p>Спасибо ${thanksSubject}, за письмо. Материалы сохраним для будущих проектов.</p>

<p>Чтобы не было в будущем недоразумений, уточните, пожалуйста:</p>

<p>Каков статус по правам в присланных вами произведениях? (эксклюзив / неэксклюзив, есть ли издатель или лейбл?)</p>

<p>Пока — загляните в наш каталог для sync-лицензирования: <a href="https://syncoteca.pro">syncoteca.pro</a>.</p>

<p>И если интересна изнанка индустрии — есть наша книга <em>«Музыкальный продюсер в кино»</em>, доступна на <a href="https://eksmo.ru/book/muzykalnyy-prodyuser-v-kino-u-n--ITD1380619/">сайте ЭКСМО</a>.</p>

<hr style="border:none;border-top:1px solid #eee;margin:24px 0">

<p style="font-size:13px;color:#555">
  Подписывайтесь на нас:<br>
  <a href="https://www.instagram.com/sync_lab_music_agency/">Instagram</a> &nbsp;|&nbsp;
  <a href="https://t.me/synclab">Telegram</a>
</p>

<p style="font-size:11px;color:#aaa">Denis Sharko · Synclab · denis@synclab.pro</p>`;

  const text = `Привет, ${name}!

Спасибо ${thanksSubject}, за письмо. Материалы сохраним для будущих проектов.

Чтобы не было в будущем недоразумений, уточните, пожалуйста:

Каков статус по правам в присланных вами произведениях? (эксклюзив / неэксклюзив, есть ли издатель или лейбл?)

Пока — загляните в наш каталог для sync-лицензирования: https://syncoteca.pro

И если интересна изнанка индустрии — есть наша книга «Музыкальный продюсер в кино», доступна на сайте ЭКСМО: https://eksmo.ru/book/muzykalnyy-prodyuser-v-kino-u-n--ITD1380619/

---
Instagram: https://www.instagram.com/sync_lab_music_agency/
Telegram: https://t.me/synclab

Denis Sharko | Synclab`;

  return { subject, html, text };
}
