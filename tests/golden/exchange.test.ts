import { describe, expect, it } from 'vitest';
import { buildExchange, buildOpening } from '../../src/domain/operations.ts';
import { B, L, byn, run, snapshot, usd } from './fixtures.ts';

/**
 * Золотой тест 3 — обмен валют внутри корзины.
 * Рубли меняются на доллары внутри одной корзины, курс считается и сохраняется.
 */
describe('Золотой тест 3: обмен валют', () => {
  const exchange = buildExchange({
    date: '2025-05-05',
    bucketId: B.big,
    description: 'Перелив в доллар',
    given: { locationId: L.savings, currency: 'BYN', amount: byn(850) },
    received: { locationId: L.fxCard, currency: 'USD', amount: usd(268.75) },
    decimals: { given: 2, received: 2 },
  });

  const { holdings, errors, warnings } = run([
    buildOpening({
      date: '2025-05-01',
      lines: [
        { bucketId: B.big, locationId: L.savings, currency: 'BYN', amount: byn(2140.5) },
      ],
    }),
    exchange,
  ]);

  it('сохраняет курс 3,1628 BYN за доллар', () => {
    expect(exchange.operation.meta?.rate).toBe(3.1628);
  });

  it('проходит без ошибок', () => {
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('позиции меняются корректно', () => {
    expect(snapshot(holdings, B.big)).toEqual({
      'Накопительный BYN': byn(1290.5),
      'Валютная карта USD': usd(268.75),
    });
  });

  it('комиссия списывается в валюте списания отдельной проводкой', () => {
    const withFee = buildExchange({
      date: '2025-05-05',
      bucketId: B.big,
      given: { locationId: L.savings, currency: 'BYN', amount: byn(850) },
      received: { locationId: L.fxCard, currency: 'USD', amount: usd(268.75) },
      fee: byn(2.5),
      decimals: { given: 2, received: 2 },
    });

    expect(withFee.operation.meta?.fee).toBe(byn(2.5));
    expect(withFee.entries).toHaveLength(3);

    const bynTotal = withFee.entries
      .filter((e) => e.currency === 'BYN')
      .reduce((sum, e) => sum + e.amount, 0);
    expect(bynTotal).toBe(-byn(852.5));
  });
});
