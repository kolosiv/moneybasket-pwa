import { describe, expect, it } from 'vitest';
import { makeFormat } from '../../src/app/format.ts';
import { DEFAULT_CURRENCIES } from '../../src/domain/currencies.ts';
import { toMinor } from '../../src/domain/money.ts';
import { buildExchange, buildExpense } from '../../src/domain/operations.ts';
import { formFromDraft } from '../../src/features/entry/state.ts';
import type { Location } from '../../src/domain/types.ts';

const format = makeFormat(DEFAULT_CURRENCIES);
const m = (major: number) => toMinor(major, 2);

const SAFE = 'l-safe';
const CASH = 'l-cash';
const CARD = 'l-card';

const locations: Location[] = [
  { id: SAFE, name: 'Накопительный', kind: 'bank', archived: false, sort: 0 },
  { id: CARD, name: 'Валютная карта', kind: 'bank', archived: false, sort: 1 },
  { id: CASH, name: 'Наличка', kind: 'cash', archived: false, sort: 5 },
];

/** Порядок проводок в базе задаётся случайными uuid, поэтому его тасуем. */
const shuffled = <T,>(items: T[]): T[] => [...items].reverse();

describe('редактирование не зависит от порядка проводок в базе', () => {
  it('строки раздельной оплаты идут в порядке мест, а не как легли в базу', () => {
    // Раздельная оплата: 12 р с накопительного + 135 р наличкой.
    const draft = buildExpense({
      date: '2025-03-06',
      bucketId: 'b-big',
      description: 'Цветы',
      lines: [
        { locationId: SAFE, currency: 'BYN', amount: m(12) },
        { locationId: CASH, currency: 'BYN', amount: m(135) },
      ],
    });

    for (const entries of [draft.entries, shuffled(draft.entries)]) {
      const form = formFromDraft({ operation: draft.operation, entries }, locations, format);
      expect(form!.lines.map((l) => [l.locationId, l.amount])).toEqual([
        [SAFE, '12,00'],
        [CASH, '135,00'],
      ]);
    }
  });

  it('комиссия обмена не подменяет собой основную сумму', () => {
    const draft = buildExchange({
      date: '2025-05-05',
      bucketId: 'b-big',
      given: { locationId: SAFE, currency: 'BYN', amount: m(850) },
      received: { locationId: CARD, currency: 'USD', amount: m(268.75) },
      fee: m(2.5),
      decimals: { given: 2, received: 2 },
    });

    for (const entries of [draft.entries, shuffled(draft.entries)]) {
      const form = formFromDraft({ operation: draft.operation, entries }, locations, format);
      expect(form!.from.amount).toBe('850,00');
      expect(form!.from.currency).toBe('BYN');
      expect(form!.to.amount).toBe('268,75');
      expect(form!.fee).toBe('2,50');
    }
  });

  it('обмен без комиссии восстанавливается без выдуманной комиссии', () => {
    const draft = buildExchange({
      date: '2025-05-05',
      bucketId: 'b-big',
      given: { locationId: SAFE, currency: 'BYN', amount: m(850) },
      received: { locationId: CARD, currency: 'USD', amount: m(268.75) },
      decimals: { given: 2, received: 2 },
    });

    for (const entries of [draft.entries, shuffled(draft.entries)]) {
      const form = formFromDraft({ operation: draft.operation, entries }, locations, format);
      expect(form!.from.amount).toBe('850,00');
      expect(form!.fee).toBe('');
    }
  });
});
