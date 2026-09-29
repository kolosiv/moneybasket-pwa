/**
 * Деньги — только целые числа в минорных единицах (копейки, центы).
 * Никаких float в хранении и расчётах. Всё форматирование живёт здесь.
 */

const NBSP = ' ';

/** 10^decimals, без Math.pow с плавающей точкой. */
export function minorFactor(decimals: number): number {
  let f = 1;
  for (let i = 0; i < decimals; i++) f *= 10;
  return f;
}

/**
 * Разбирает пользовательский ввод в минорные единицы.
 * Принимает и запятую, и точку; пробелы (в т.ч. неразрывные) игнорируются.
 * Лишние знаки после запятой отбрасываются с округлением half-up.
 * Возвращает null, если строка не число.
 */
export function parseAmount(input: string, decimals: number): number | null {
  const cleaned = input.replace(/[\s  ]/g, '').replace(',', '.');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;

  const negative = cleaned.startsWith('-');
  const body = negative ? cleaned.slice(1) : cleaned;
  const dot = body.indexOf('.');
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracRaw = dot === -1 ? '' : body.slice(dot + 1);

  // Округляем half-up по первому отбрасываемому знаку, не уходя во float.
  const frac = fracRaw.slice(0, decimals).padEnd(decimals, '0');
  const nextDigit = fracRaw.charCodeAt(decimals) - 48;
  const roundUp = nextDigit >= 5 && nextDigit <= 9;

  const digits = `${intPart || '0'}${frac}`;
  const value = Number(digits) + (roundUp ? 1 : 0);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** Минорные единицы → строка `1 234,56` (ru-RU, всегда с decimals знаками). */
export function formatAmount(minor: number, decimals: number): string {
  const factor = minorFactor(decimals);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const intPart = Math.trunc(abs / factor);
  const fracPart = abs % factor;

  const intStr = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const body =
    decimals > 0 ? `${intStr},${String(fracPart).padStart(decimals, '0')}` : intStr;
  return negative ? `−${body}` : body;
}

/** `1 234,56 р` — сумма вместе с символом валюты. */
export function formatMoney(
  minor: number,
  currency: { symbol: string; decimals: number },
): string {
  return `${formatAmount(minor, currency.decimals)}${NBSP}${currency.symbol}`;
}

/** Число в основных единицах → минорные. Только для сидов и тестов. */
export function toMinor(major: number, decimals: number): number {
  return Math.round(major * minorFactor(decimals));
}

/** Минорные → число в основных единицах. Только для конвертации по курсу. */
export function toMajor(minor: number, decimals: number): number {
  return minor / minorFactor(decimals);
}

export function sumAmounts(amounts: readonly number[]): number {
  let total = 0;
  for (const a of amounts) total += a;
  return total;
}
