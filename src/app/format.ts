import { findCurrency } from '../domain/currencies.ts';
import { formatAmount, formatMoney, parseAmount } from '../domain/money.ts';
import type { Currency, CurrencyCode } from '../domain/types.ts';

/** Форматирование, привязанное к текущему списку валют. */
export function makeFormat(currencies: readonly Currency[]) {
  return {
    /** `1 234,56 р` */
    money(minor: number, code: CurrencyCode): string {
      return formatMoney(minor, findCurrency(currencies, code));
    },
    /** `1 234,56` — без символа валюты. */
    amount(minor: number, code: CurrencyCode): string {
      return formatAmount(minor, findCurrency(currencies, code).decimals);
    },
    decimals(code: CurrencyCode): number {
      return findCurrency(currencies, code).decimals;
    },
    symbol(code: CurrencyCode): string {
      return findCurrency(currencies, code).symbol;
    },
    parse(input: string, code: CurrencyCode): number | null {
      return parseAmount(input, findCurrency(currencies, code).decimals);
    },
  };
}

export type Format = ReturnType<typeof makeFormat>;

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const MONTHS_NOMINATIVE = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/** `YYYY-MM-DD` в локальной дате Europe/Minsk без сдвигов часового пояса. */
export function todayIso(now = new Date()): string {
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days));
  return date.toISOString().slice(0, 10);
}

/** `7 сентября` или `7 сентября 2025`, если год не текущий. */
export function formatDate(iso: string, today = todayIso()): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  const month = MONTHS[m - 1] ?? '';
  return sameYear ? `${d} ${month}` : `${d} ${month} ${y}`;
}

export function formatDateRelative(iso: string, today = todayIso()): string {
  if (iso === today) return 'сегодня';
  if (iso === shiftIso(today, -1)) return 'вчера';
  return formatDate(iso, today);
}

/** `YYYY-MM` → `Сентябрь 2025`. */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return `${MONTHS_NOMINATIVE[m - 1] ?? ''} ${y}`;
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}
