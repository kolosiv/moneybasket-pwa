import { DEFAULT_CURRENCIES } from '../../src/domain/currencies.ts';
import { computeHoldings } from '../../src/domain/holdings.ts';
import { toMinor } from '../../src/domain/money.ts';
import { hasErrors, validateOperation } from '../../src/domain/validation.ts';
import type { Holding, Location, OperationDraft } from '../../src/domain/types.ts';

export const currencies = DEFAULT_CURRENCIES;

export const B = {
  big: 'bucket-big',
  vacation: 'bucket-vacation',
  crypto: 'bucket-crypto',
  unallocated: 'bucket-unallocated',
} as const;

export const L = {
  savings: 'loc-savings',
  fxCard: 'loc-fx-card',
  account: 'loc-account',
  euroCard: 'loc-euro-card',
  debit: 'loc-debit',
  cash: 'loc-cash',
  piggy: 'loc-piggy',
  dacha: 'loc-dacha',
  exchange: 'loc-exchange',
  debtAnya: 'loc-debt-anya',
  debtBrother: 'loc-debt-brother',
  debtPocket: 'loc-debt-pocket',
} as const;

export const locations: Location[] = [
  { id: L.savings, name: 'Накопительный', kind: 'bank', archived: false, sort: 0 },
  { id: L.fxCard, name: 'Валютная карта', kind: 'bank', archived: false, sort: 1 },
  { id: L.account, name: 'Расчётный счёт', kind: 'bank', archived: false, sort: 2 },
  { id: L.euroCard, name: 'Евро-карта', kind: 'bank', archived: false, sort: 3 },
  { id: L.debit, name: 'Дебетовая карта', kind: 'bank', archived: false, sort: 4 },
  { id: L.cash, name: 'Наличка', kind: 'cash', archived: false, sort: 5 },
  { id: L.piggy, name: 'Копилка', kind: 'cash', archived: false, sort: 6 },
  { id: L.dacha, name: 'Дача', kind: 'cash', archived: false, sort: 7 },
  { id: L.exchange, name: 'Биржа', kind: 'exchange', archived: false, sort: 8 },
  { id: L.debtAnya, name: 'Долг: Аня', kind: 'receivable', counterparty: 'Аня', archived: false, sort: 9 },
  { id: L.debtBrother, name: 'Долг: Брат', kind: 'receivable', counterparty: 'Брат', archived: false, sort: 10 },
  { id: L.debtPocket, name: 'Долг: Карманные', kind: 'receivable', counterparty: 'Карманные', archived: false, sort: 11 },
];

/** Суммы в тестах пишем в основных единицах, как их видит человек. */
export const byn = (major: number) => toMinor(major, 2);
export const usd = (major: number) => toMinor(major, 2);
export const eur = (major: number) => toMinor(major, 2);

/**
 * Прогоняет операции через доменный слой: валидирует каждую на остатках,
 * накопленных предыдущими, и возвращает итоговые позиции.
 */
export function run(drafts: readonly OperationDraft[]): {
  holdings: Holding[];
  errors: string[];
  warnings: string[];
} {
  const entries = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const draft of drafts) {
    const issues = validateOperation(draft, {
      locations,
      currencies,
      holdings: computeHoldings(entries),
    });
    for (const issue of issues) {
      if (issue.level === 'error') errors.push(issue.message);
      else warnings.push(issue.message);
    }
    if (!hasErrors(issues)) entries.push(...draft.entries);
  }

  return { holdings: computeHoldings(entries), errors, warnings };
}

/** Компактный снимок позиций одной корзины: `место currency` → сумма. */
export function snapshot(
  holdings: readonly Holding[],
  bucketId: string,
): Record<string, number> {
  const nameOf = (id: string) => locations.find((l) => l.id === id)?.name ?? id;
  const out: Record<string, number> = {};
  for (const h of holdings) {
    if (h.bucketId !== bucketId) continue;
    out[`${nameOf(h.locationId)} ${h.currency}`] = h.amount;
  }
  return out;
}
