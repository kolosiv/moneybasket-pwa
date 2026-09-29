import type { Currency, CurrencyCode } from './types.ts';

export const DEFAULT_CURRENCIES: Currency[] = [
  { code: 'BYN', symbol: 'р', decimals: 2, sort: 0 },
  { code: 'USD', symbol: '$', decimals: 2, sort: 1 },
  { code: 'EUR', symbol: '€', decimals: 2, sort: 2 },
  { code: 'USDT', symbol: 'USDT', decimals: 2, usdPeg: true, sort: 3 },
];

const FALLBACK: Currency = { code: '?', symbol: '?', decimals: 2, sort: 99 };

export function findCurrency(
  currencies: readonly Currency[],
  code: CurrencyCode,
): Currency {
  return currencies.find((c) => c.code === code) ?? { ...FALLBACK, code, symbol: code };
}

export function decimalsOf(
  currencies: readonly Currency[],
  code: CurrencyCode,
): number {
  return findCurrency(currencies, code).decimals;
}
