import { isValid, parse, parseISO, startOfDay, subDays, subHours, subMinutes, subSeconds, type Locale } from "date-fns";
import { ar, de, enUS, es, fr, id, it, ja, ko, pl, pt, ptBR, ru, th, tr, vi, zhCN } from "date-fns/locale";

/**
 * Mangayomi's `parseDates` for source plugins: each date (a timestamp, an
 * ISO date, "3 days ago" in a dozen languages, or text in the plugin's
 * format and locale) becomes epoch milliseconds as a string. Unparseable
 * dates read as now, as in Mangayomi. Formats use the same Unicode tokens as
 * Dart's intl, so plugins' patterns (`MMMM d, yyyy`) work unchanged.
 */
const LOCALES = new Map<string, Locale>(Object.entries({
  en: enUS, en_US: enUS, es, fr, pt, pt_BR: ptBR, id, it, ru, de, tr, vi, ar, ja, ko, zh: zhCN, th, pl,
}));
const NUMERIC_FORMATS = [
  "yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy", "yyyy/MM/dd", "dd-MM-yyyy", "MM-dd-yyyy", "dd.MM.yyyy", "MM.dd.yyyy", "yyyy.MM.dd",
  "d/M/yyyy", "M/d/yyyy", "yyyy/M/d", "d-M-yyyy", "M-d-yyyy", "yyyy-M-d", "d.M.yyyy", "M.d.yyyy", "yyyy.M.d",
];
const TEXT_FORMATS = [
  "dd MMMM yyyy", "MMMM dd, yyyy", "yyyy MMMM dd", "dd MMM yyyy", "MMM dd yyyy", "yyyy MMM dd", "dd MMMM, yyyy", "yyyy, MMMM dd",
  "MMMM dd yyyy", "MMM dd, yyyy", "dd LLLL yyyy", "LLLL dd, yyyy", "MMM d, yyyy", "d MMMM yyyy", "dd 'de' MMMM 'de' yyyy",
  "yyyy'年'M'月'd", "d MMMM, yyyy",
];

const words = (list: string): readonly string[] => list.split("|");
const TODAY = words("today|hoy|aujourd'hui|oggi|heute|bugün|hari ini|اليوم|今天|hôm nay");
const YESTERDAY = words("yesterday|ayer|hier|ieri|gestern|dün|kemarin|يوم واحد|أمس|昨天|hôm qua");
const TWO_DAYS_AGO = words("يومين|anteayer|avant-hier|l'altro ieri|vorgestern|前天|hôm kia");
// Checked in this order, as Mangayomi does; short units ("d", "h", "m", "s") match loosely on purpose.
const UNITS: readonly (readonly [readonly string[], (date: Date, amount: number) => Date])[] = [
  [words("hari|gün|jour|día|dia|day|วัน|ngày|giorni|أيام|天|d|tage|tag"), subDays],
  [words("jam|saat|heure|hora|hour|ชั่วโมง|giờ|ore|ساعة|小时|h|stunden|stunde"), subHours],
  [words("menit|dakika|min|minute|minuto|นาที|دقائق|m|minuten"), subMinutes],
  [words("detik|segundo|second|วินาที|sec|s|sekunden"), subSeconds],
  [words("week|semana|semaine|woche|settimana|tuần|w"), (date, amount) => subDays(date, amount * 7)],
  [words("month|mes|mois|monat|mese|tháng|mês"), (date, amount) => subDays(date, amount * 30)],
  [words("year|año|an|jahr|anno|năm|ano"), (date, amount) => subDays(date, amount * 365)],
];

function relative(lower: string, now: Date): Date | null {
  const amount = Number(/\d+/u.exec(lower)?.[0] ?? Number.NaN);
  const unit = UNITS.find(([names]) => names.some((name) => lower.includes(name)));
  return Number.isFinite(amount) && unit !== undefined ? unit[1](now, amount) : null;
}

interface Attempt {
  readonly format: string;
  readonly locale: Locale | undefined;
  readonly now: Date;
}

function withFormat(text: string, { format, locale, now }: Attempt): Date | null {
  try {
    const parsed = parse(text, format, now, locale === undefined ? {} : { locale });
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function guessed(text: string, now: Date, preferred: string): Date | null {
  if (!/\p{L}/u.test(text)) {
    return NUMERIC_FORMATS.map((format) => withFormat(text, { format, locale: enUS, now })).find((date) => date !== null) ?? null;
  }
  const locales = [...new Set([preferred, ...LOCALES.keys()])].flatMap((name) => {
    const locale = LOCALES.get(name);
    return locale === undefined ? [] : [locale];
  });
  for (const locale of locales) {
    const found = TEXT_FORMATS.map((format) => withFormat(text, { format, locale, now })).find((date) => date !== null);
    if (found !== undefined) {
      return found;
    }
  }
  return null;
}

function quick(text: string, now: Date): Date | null {
  if (/^\d+$/u.test(text)) {
    return text.length === 10 ? new Date(Number(text) * 1000) : new Date(Number(text));
  }
  if (text.includes("T")) {
    const iso = parseISO(text);
    return isValid(iso) ? iso : null;
  }
  const lower = text.toLowerCase();
  if (TODAY.some((word) => lower.startsWith(word))) {
    return startOfDay(now);
  }
  if (YESTERDAY.some((word) => lower.startsWith(word))) {
    return startOfDay(subDays(now, 1));
  }
  return TWO_DAYS_AGO.some((word) => lower.startsWith(word)) ? startOfDay(subDays(now, 2)) : null;
}

interface Request {
  readonly format: string;
  readonly localeName: string;
  readonly now: Date;
}

function parseOne(raw: string, { format, localeName, now }: Request): number {
  const text = raw.trim();
  const fast = quick(text, now);
  if (fast !== null) {
    return fast.getTime();
  }
  const cleaned = text.replaceAll(/(?<day>\d+)(?:st|nd|rd|th)\b/giu, "$<day>");
  const locale = LOCALES.get(localeName) ?? LOCALES.get(localeName.split(/[_-]/u)[0] ?? "");
  const found = (format === "" ? null : withFormat(cleaned, { format, locale, now })) ?? guessed(cleaned, now, localeName) ?? relative(text.toLowerCase(), now);
  const iso = found ?? parseISO(text);
  return isValid(iso) ? iso.getTime() : now.getTime();
}

export function parseDates(values: readonly unknown[], format: string, locale: string): readonly string[] {
  const now = new Date();
  return values.flatMap((value) => {
    const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    return text === "" ? [] : [String(parseOne(text, { format, localeName: locale, now }))];
  });
}
