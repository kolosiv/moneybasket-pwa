import { findCurrency } from './currencies.ts';
import { minorFactor } from './money.ts';
import type { Currency, CurrencyCode, Holding, Rate } from './types.ts';

/** Последний по дате курс для каждой валюты. */
export function latestRates(rates: readonly Rate[]): Map<CurrencyCode, Rate> {
  const out = new Map<CurrencyCode, Rate>();
  for (const rate of rates) {
    const current = out.get(rate.currency);
    if (!current || rate.date > current.date) out.set(rate.currency, rate);
  }
  return out;
}

/**
 * Сколько BYN за одну единицу валюты. Для BYN — 1.
 * USDT приравнивается к USD, если своего курса нет.
 * Возвращает null, если курс неизвестен — считать «примерно» не по чему.
 */
export function bynPerUnit(
  currency: CurrencyCode,
  rates: Map<CurrencyCode, Rate>,
  currencies: readonly Currency[],
  baseCurrency: CurrencyCode = 'BYN',
): number | null {
  if (currency === baseCurrency) return 1;
  const direct = rates.get(currency);
  if (direct) return direct.bynPerUnit;
  if (findCurrency(currencies, currency).usdPeg) {
    return rates.get('USD')?.bynPerUnit ?? null;
  }
  return null;
}

export interface ConversionResult {
  /** Сумма в минорных единицах целевой валюты. */
  amount: number;
  /** Валюты, для которых не нашлось курса — итог занижен на их величину. */
  missing: CurrencyCode[];
}

/**
 * Сводит позиции в одну валюту. Результат приблизительный («≈»),
 * поэтому округляется до минорной единицы целевой валюты в самом конце.
 */
export function convertHoldings(
  holdings: readonly Holding[],
  target: CurrencyCode,
  rates: readonly Rate[],
  currencies: readonly Currency[],
  baseCurrency: CurrencyCode = 'BYN',
): ConversionResult {
  const latest = latestRates(rates);
  const targetRate = bynPerUnit(target, latest, currencies, baseCurrency);
  if (targetRate === null || targetRate === 0) {
    return { amount: 0, missing: [target] };
  }
  const targetDecimals = findCurrency(currencies, target).decimals;

  let totalMajor = 0;
  const missing = new Set<CurrencyCode>();
  for (const h of holdings) {
    const rate = bynPerUnit(h.currency, latest, currencies, baseCurrency);
    if (rate === null) {
      missing.add(h.currency);
      continue;
    }
    const decimals = findCurrency(currencies, h.currency).decimals;
    totalMajor += (h.amount / minorFactor(decimals)) * rate;
  }

  return {
    amount: Math.round((totalMajor / targetRate) * minorFactor(targetDecimals)),
    missing: [...missing],
  };
}
