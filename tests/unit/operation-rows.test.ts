import { describe, expect, it } from 'vitest';
import {
  buildRows,
  describeOperation,
} from '../../src/features/operations/OperationList.tsx';
import {
  buildExchange,
  buildExpense,
  buildMove,
  buildReallocate,
  buildTopup,
} from '../../src/domain/operations.ts';
import { toMinor } from '../../src/domain/money.ts';
import type { Entry, Operation, OperationDraft } from '../../src/domain/types.ts';

const m = (major: number) => toMinor(major, 2);
const BIG = 'b-big';
const CRYPTO = 'b-crypto';
const SAFE = 'l-safe';
const CASH = 'l-cash';
const CARD = 'l-card';

/** Разворачивает черновики в то, что отдала бы база. */
function flatten(drafts: OperationDraft[]): {
  operations: Operation[];
  entries: Entry[];
} {
  return {
    operations: drafts.map((d) => d.operation),
    entries: drafts.flatMap((d) => d.entries),
  };
}

const expense = buildExpense({
  date: '2025-03-04',
  bucketId: BIG,
  description: 'Такси',
  lines: [{ locationId: SAFE, currency: 'BYN', amount: m(18.4) }],
});

const move = buildMove({
  date: '2025-03-01',
  bucketId: BIG,
  currency: 'BYN',
  amount: m(280),
  fromLocationId: CASH,
  toLocationId: SAFE,
  description: 'С налички на накопительный',
});

const topup = buildTopup({
  date: '2025-03-09',
  bucketId: BIG,
  locationId: SAFE,
  currency: 'BYN',
  amount: m(620),
  source: 'advance',
});

const swap = buildReallocate({
  date: '2025-06-18',
  description: 'КП продаёт доллары Крипте',
  legs: [
    { fromBucketId: BIG, toBucketId: CRYPTO, locationId: CARD, currency: 'USD', amount: m(275.4) },
    { fromBucketId: CRYPTO, toBucketId: BIG, locationId: SAFE, currency: 'BYN', amount: m(820) },
  ],
});

describe('строки ленты операций', () => {
  const all = flatten([expense, move, topup, swap]);

  it('по всем корзинам считает нетто-изменение', () => {
    const rows = buildRows(all.operations, all.entries);
    const byId = new Map(rows.map((r) => [r.operation.id, r]));

    expect([...byId.get(expense.operation.id)!.delta]).toEqual([['BYN', -m(18.4)]]);
    expect([...byId.get(topup.operation.id)!.delta]).toEqual([['BYN', m(620)]]);
  });

  it('перемещение внутри корзины даёт нулевое нетто и валовую сумму', () => {
    const rows = buildRows(all.operations, all.entries);
    const row = rows.find((r) => r.operation.id === move.operation.id)!;

    expect(row.delta.size).toBe(0);
    expect([...row.gross]).toEqual([['BYN', m(280)]]);
  });

  it('встречный перевод по всем корзинам нулевой, но объём виден', () => {
    const rows = buildRows(all.operations, all.entries);
    const row = rows.find((r) => r.operation.id === swap.operation.id)!;

    expect(row.delta.size).toBe(0);
    expect(row.gross.get('USD')).toBe(m(275.4));
    expect(row.gross.get('BYN')).toBe(m(820));
    expect(row.bucketIds.sort()).toEqual([BIG, CRYPTO]);
  });

  it('в области одной корзины перевод показывает её движение, а не ноль', () => {
    const rows = buildRows(all.operations, all.entries, BIG);
    const row = rows.find((r) => r.operation.id === swap.operation.id)!;

    expect(row.delta.get('USD')).toBe(-m(275.4));
    expect(row.delta.get('BYN')).toBe(m(820));
    expect(row.bucketIds).toEqual([BIG]);
  });

  it('обмен валют показывает обе стороны', () => {
    const exchange = buildExchange({
      date: '2025-05-05',
      bucketId: BIG,
      given: { locationId: SAFE, currency: 'BYN', amount: m(850) },
      received: { locationId: CARD, currency: 'USD', amount: m(268.75) },
      decimals: { given: 2, received: 2 },
    });
    const one = flatten([exchange]);
    const row = buildRows(one.operations, one.entries)[0]!;

    expect(row.delta.get('BYN')).toBe(-m(850));
    expect(row.delta.get('USD')).toBe(m(268.75));
  });

  it('операции без проводок в области просмотра выпадают из ленты', () => {
    const rows = buildRows(all.operations, all.entries, CRYPTO);
    expect(rows.map((r) => r.operation.id)).toEqual([swap.operation.id]);
  });

  it('порядок операций сохраняется — сортировку задаёт выборка из базы', () => {
    const rows = buildRows(all.operations, all.entries);
    expect(rows.map((r) => r.operation.id)).toEqual(
      all.operations.map((o) => o.id),
    );
  });

  it('удалённые операции не попадают: их отсеивает выборка', () => {
    const live = all.operations.filter((o) => o.id !== expense.operation.id);
    const rows = buildRows(live, all.entries);
    expect(rows.some((r) => r.operation.id === expense.operation.id)).toBe(false);
  });
});

describe('подписи операций', () => {
  it('курс показывается с запятой, как остальные числа', () => {
    const exchange = buildExchange({
      date: '2025-05-05',
      bucketId: BIG,
      given: { locationId: SAFE, currency: 'BYN', amount: m(850) },
      received: { locationId: CARD, currency: 'USD', amount: m(268.75) },
      decimals: { given: 2, received: 2 },
    });
    const one = flatten([exchange]);
    const row = buildRows(one.operations, one.entries)[0]!;
    expect(describeOperation(row)).toBe('Обмен · курс 3,1628');
  });

  it('без курса подпись — просто тип операции', () => {
    const one = flatten([expense]);
    const row = buildRows(one.operations, one.entries)[0]!;
    expect(describeOperation(row)).toBe('Расход');
  });

  it('у операций вне быстрого ввода тоже есть человеческая подпись', () => {
    const one = flatten([swap]);
    const row = buildRows(one.operations, one.entries)[0]!;
    expect(describeOperation(row)).toBe('Между корзинами');
  });
});
