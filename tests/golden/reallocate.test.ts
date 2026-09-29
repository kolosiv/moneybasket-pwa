import { describe, expect, it } from 'vitest';
import { buildOpening, buildReallocate } from '../../src/domain/operations.ts';
import { totalsByCurrency } from '../../src/domain/holdings.ts';
import { B, L, byn, run, snapshot, usd } from './fixtures.ts';

/**
 * Золотой тест 4 — встречный перевод между корзинами.
 * Сценарий из раздела 4.3 ТЗ: одна корзина продаёт доллары другой за рубли.
 */
describe('Золотой тест 4: встречный перевод между корзинами', () => {
  const opening = buildOpening({
    date: '2025-06-17',
    lines: [
      { bucketId: B.big, locationId: L.fxCard, currency: 'USD', amount: usd(275.4) },
      { bucketId: B.big, locationId: L.savings, currency: 'BYN', amount: byn(1830.6) },
      { bucketId: B.crypto, locationId: L.savings, currency: 'BYN', amount: byn(820) },
      { bucketId: B.crypto, locationId: L.fxCard, currency: 'USD', amount: usd(412.85) },
    ],
  });

  const swap = buildReallocate({
    date: '2025-06-18',
    description: 'КП продаёт 275,40$ Крипте за 820р',
    legs: [
      // Доллары уезжают из Крупных покупок в Крипту
      {
        fromBucketId: B.big,
        toBucketId: B.crypto,
        locationId: L.fxCard,
        currency: 'USD',
        amount: usd(275.4),
      },
      // Рубли — встречно, из Крипты в Крупные покупки
      {
        fromBucketId: B.crypto,
        toBucketId: B.big,
        locationId: L.savings,
        currency: 'BYN',
        amount: byn(820),
      },
    ],
  });

  const before = run([opening]);
  const after = run([opening, swap]);

  it('проходит без ошибок', () => {
    expect(after.errors).toEqual([]);
    expect(after.warnings).toEqual([]);
  });

  it('общий итог по каждой валюте не изменился', () => {
    expect(totalsByCurrency(after.holdings)).toEqual(totalsByCurrency(before.holdings));
  });

  it('в Крупных покупках доллары ушли, рубли пришли', () => {
    expect(snapshot(after.holdings, B.big)).toEqual({
      'Накопительный BYN': byn(2650.6),
    });
  });

  it('в Крипте наоборот', () => {
    expect(snapshot(after.holdings, B.crypto)).toEqual({
      'Валютная карта USD': usd(688.25),
    });
  });
});
