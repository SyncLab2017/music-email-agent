import { env, ParsedEmailSchema, type ParsedEmail } from "./env.js";

const SYSTEM_PROMPT = `Ты — ассистент для парсинга музыкальных заявок (Demo Drop).

ТВОЯ ЗАДАЧА — проанализировать входные данные, которые состоят из МЕТАДАННЫХ (от кого пришло письмо реально) и ТЕЛА ПИСЬМА.

ЛОГИКА РАБОТЫ:
1. Сначала проверь ТЕЛО ПИСЬМА. Если это ПЕРЕСЛАННОЕ письмо (начинается с 'Fwd:', 'Пересылаемое сообщение', или содержит технический заголовок '... написал(а):'), то извлекай данные (Email, Имя) из текста этого заголовка.
2. Если это ПРЯМОЕ письмо (нет признаков пересылки), бери 'email' и 'contact_name' из предоставленных полей METADATA_FROM.

ВЕРНИ JSON с такими полями:
1. date: Дата получения письма. Формат: 'YYYY-MM-DD'. Если есть дата в тексте пересылки — бери её, иначе бери из METADATA_DATE.
2. contact_name: Имя Фамилия автора. Если имя на латинице, транслитерируй/переведи на русский (Sergey -> Сергей). Если в метаданных только email, попробуй найти подпись в конце письма.
3. artist_name: Название проекта/группы. Если не указано явно, дублируй имя.
4. email: Реальный email автора. Для прямых писем бери из METADATA_FROM. Для пересланных — из тела письма.
5. telegram: Юзернейм телеграм (через @), если есть в тексте.
6. city: Город, если указан.
7. music_links: Если в теме или тексте есть 'SourceAudio' — пиши строго 'SourceAudio'. ИНАЧЕ — ищи ссылки (Google Drive, Yandex Disk, SoundCloud).
8. other_links: Ссылки на соцсети, сайт.
9. references: Новое поле. Если автор пишет 'подойдет для проекта Х', 'в стиле сериала Y', 'референс к Z' — перечисли эти проекты/референсы через запятую. Если нет — ставь null.
10. summary: Краткая суть письма (1-2 предложения, о чем музыка, жанр, цель).

Если поле не найдено — null.`;

interface DeepSeekResponse {
  choices: Array<{ message: { content: string } }>;
}

function normalizeDate(input: string | null | undefined): string {
  if (!input) return new Date().toISOString().slice(0, 10);
  const dotMatch = input.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotMatch) return `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}`;
  const isoMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const parsed = Date.parse(input);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

export async function parseEmail(input: {
  from: string;
  subject: string;
  date: string;
  text: string;
}): Promise<ParsedEmail> {
  const body = {
    model: env.deepseek.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `METADATA_FROM: ${input.from}\n` +
          `METADATA_SUBJECT: ${input.subject}\n` +
          `METADATA_DATE: ${input.date}\n\n` +
          `BODY_TEXT:\n${input.text}`,
      },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  };

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.deepseek.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`DeepSeek ${res.status}: ${errText.slice(0, 500)}`);
  }

  const json = (await res.json()) as DeepSeekResponse;
  const content = json.choices?.[0]?.message?.content ?? "";
  const clean = content.replace(/```json/g, "").replace(/```/g, "").trim();
  const raw = JSON.parse(clean);
  const parsed = ParsedEmailSchema.parse(raw);
  parsed.date = normalizeDate(parsed.date ?? null);
  return parsed;
}
