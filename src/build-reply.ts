import type { ParsedEmail } from "./env.js";

export interface DraftReply {
  subject: string;
  html: string;
  text: string;
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, "");
}

export function buildReply(input: {
  parsed: ParsedEmail;
  originalSubject: string;
}): DraftReply | null {
  const email = input.parsed.email;
  if (!email) return null;

  const name = input.parsed.contact_name || "Музыкант";
  const artist = input.parsed.artist_name;
  const links = input.parsed.music_links;
  const refs = input.parsed.references;

  const subject = "Re: " + input.originalSubject.replace(/^Re:\s*/i, "");

  let personalized =
    artist && artist !== input.parsed.contact_name
      ? `Получили заявку от проекта <strong>${artist}</strong>.`
      : "Получили вашу заявку.";
  if (links) {
    personalized += " Ссылки на музыку зафиксированы — обязательно послушаем.";
  }

  const questions: string[] = [];
  if (!links) {
    questions.push(
      "Пришлите ссылки на вашу музыку (SoundCloud, Google Drive, Яндекс Диск и т.п.)",
    );
  }
  if (!refs) {
    questions.push(
      "Какие проекты или форматы вас интересуют? (фильмы, сериалы, реклама, игры — конкретные или любые?)",
    );
  }
  questions.push(
    "Каков статус прав на вашу музыку? (эксклюзив / неэксклюзив, есть ли издатель или лейбл?)",
  );
  questions.push(
    "Что приоритетнее: синхронизация в конкретных проектах или плейлисты / медиапродвижение?",
  );

  const qHtml = questions.map((q) => `  <li>${q}</li>`).join("\n");
  const qText = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");

  const html = `<p>Привет, ${name}!</p>

<p>Спасибо за письмо — мы его получили. ${personalized}</p>

<p>Чтобы рассмотреть заявку эффективнее, уточните, пожалуйста:</p>
<ul>
${qHtml}
</ul>

<p>Постараемся ответить в ближайшее время.</p>

<p>Пока — загляните в наш каталог для sync-лицензирования: <a href="https://syncoteca.pro">syncoteca.pro</a>.</p>

<p>И если интересна изнанка индустрии — есть наша книга <em>«Музыкальный продюсер в кино»</em>, доступна на <a href="https://eksmo.ru/book/muzykalnyy-prodyuser-v-kino-u-n--ITD1380619/">сайте ЭКСМО</a>.</p>

<hr style="border:none;border-top:1px solid #eee;margin:24px 0">

<p style="font-size:13px;color:#555">
  Подписывайтесь на нас:<br>
  <a href="https://www.instagram.com/sync_lab_music_agency/">Instagram</a> &nbsp;|&nbsp;
  <a href="https://t.me/synclab">Telegram</a>
</p>

<p style="font-size:11px;color:#aaa">Synclab Pro &nbsp;·&nbsp; sync@synclab.pro</p>`;

  const text = `Привет, ${name}!

Спасибо за письмо — мы его получили. ${stripTags(personalized)}

Чтобы рассмотреть заявку эффективнее, уточните:
${qText}

Постараемся ответить в ближайшее время.

Пока — загляните в наш каталог для sync-лицензирования: https://syncoteca.pro

И если интересна изнанка индустрии — есть наша книга «Музыкальный продюсер в кино», доступна на сайте ЭКСМО: https://eksmo.ru/book/muzykalnyy-prodyuser-v-kino-u-n--ITD1380619/

---
Instagram: https://www.instagram.com/sync_lab_music_agency/
Telegram: https://t.me/synclab

Synclab Pro`;

  return { subject, html, text };
}
