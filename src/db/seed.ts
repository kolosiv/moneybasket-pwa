import { DEFAULT_CURRENCIES } from '../domain/currencies.ts';
import { newId } from '../domain/operations.ts';
import type { Bucket, Currency, Location, Settings } from '../domain/types.ts';

/** Предзаполнение онбординга. Лишнее пользователь удаляет, своё добавляет. */

export function defaultBuckets(): Bucket[] {
  const names = [
    { name: 'Крупные покупки', emoji: '🛒' },
    { name: 'Отпуск', emoji: '🏖' },
    { name: 'Крипта', emoji: '₿' },
  ];
  const buckets: Bucket[] = names.map((n, i) => ({
    id: newId(),
    name: n.name,
    emoji: n.emoji,
    archived: false,
    sort: i,
  }));
  buckets.push({
    id: newId(),
    name: 'Нераспределено',
    emoji: '📥',
    system: 'unallocated',
    archived: false,
    sort: names.length,
  });
  return buckets;
}

export function defaultLocations(): Location[] {
  const preset: { name: string; kind: Location['kind'] }[] = [
    { name: 'Накопительный', kind: 'bank' },
    { name: 'Валютная карта', kind: 'bank' },
    { name: 'Расчётный счёт', kind: 'bank' },
    { name: 'Евро-карта', kind: 'bank' },
    { name: 'Дебетовая карта', kind: 'bank' },
    { name: 'Наличка', kind: 'cash' },
    { name: 'Копилка', kind: 'cash' },
    { name: 'Дача', kind: 'cash' },
    { name: 'Биржа', kind: 'exchange' },
  ];
  return preset.map((p, i) => ({
    id: newId(),
    name: p.name,
    kind: p.kind,
    archived: false,
    sort: i,
  }));
}

export function defaultCurrencies(): Currency[] {
  return DEFAULT_CURRENCIES.map((c) => ({ ...c }));
}

export function defaultSettings(): Settings {
  return {
    id: 'settings',
    baseCurrency: 'BYN',
    secondaryCurrency: 'USD',
    hideAmounts: false,
  };
}

/** Место-контрагент для займа. */
export function makeReceivable(counterparty: string, sort: number): Location {
  return {
    id: newId(),
    name: `Долг: ${counterparty}`,
    kind: 'receivable',
    counterparty,
    archived: false,
    sort,
  };
}
