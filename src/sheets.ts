import { google } from "googleapis";
import { env, type ParsedEmail } from "./env.js";

const auth = new google.auth.JWT({
  email: env.google.serviceAccount.client_email as string,
  key: env.google.serviceAccount.private_key as string,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const HEADER_ORDER = [
  "Пришло",
  "Контактное лицо",
  "Артист / Лейбл",
  "Контакт",
  "ТГ",
  "Город",
  "Ссылки",
  "Текст письма",
  "Референсы",
] as const;

function rowFromParsed(p: ParsedEmail): string[] {
  const val = (v: string | null | undefined) => v ?? "";
  return [
    val(p.date),
    val(p.contact_name),
    val(p.artist_name),
    val(p.email),
    val(p.telegram),
    val(p.city),
    val(p.music_links),
    val(p.summary),
    val(p.references),
  ];
}

export async function appendRow(parsed: ParsedEmail): Promise<void> {
  await sheets.spreadsheets.values.append({
    spreadsheetId: env.google.sheetId,
    range: `${env.google.sheetTab}!A:I`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [rowFromParsed(parsed)],
    },
  });
}

export { HEADER_ORDER };
