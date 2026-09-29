import { describe, expect, it } from 'vitest';
import { buildMove, buildOpening, buildTopup } from '../../src/domain/operations.ts';
import { B, L, byn, eur, run, snapshot, usd } from './fixtures.ts';

/**
 * Золотой тест 2 — «Отпуск»: несколько валют в одной корзине, снятие с карты
 * наличными и пополнения с аванса и зарплаты.
 * Снятие наличных — это перемещение, а не обмен: валюта не меняется.
 */
describe('Золотой тест 2: Отпуск, несколько валют', () => {
  const cashOut = (date: string, amount: number) =>
    buildMove({
      date,
      bucketId: B.vacation,
      currency: 'USD',
      amount: usd(amount),
      fromLocationId: L.debit,
      toLocationId: L.piggy,
      description: 'Снял с карты',
    });

  const operations = [
    buildOpening({
      date: '2025-03-31',
      lines: [
        { bucketId: B.vacation, locationId: L.piggy, currency: 'EUR', amount: eur(260) },
        { bucketId: B.vacation, locationId: L.piggy, currency: 'USD', amount: usd(610) },
        { bucketId: B.vacation, locationId: L.euroCard, currency: 'EUR', amount: eur(385.4) },
        { bucketId: B.vacation, locationId: L.account, currency: 'BYN', amount: byn(1750) },
        { bucketId: B.vacation, locationId: L.debit, currency: 'USD', amount: usd(318.75) },
      ],
    }),

    cashOut('2025-04-04', 65),
    cashOut('2025-04-09', 85),

    buildTopup({
      date: '2025-04-12',
      bucketId: B.vacation,
      locationId: L.savings,
      currency: 'BYN',
      amount: byn(620),
      source: 'advance',
      description: 'С аванса',
    }),

    cashOut('2025-04-16', 45),

    buildTopup({
      date: '2025-04-22',
      bucketId: B.vacation,
      locationId: L.savings,
      currency: 'BYN',
      amount: byn(310),
      source: 'salary',
      description: 'С зарплаты',
    }),

    cashOut('2025-04-26', 80),
  ];

  const { holdings, errors, warnings } = run(operations);

  it('проходит без ошибок и предупреждений', () => {
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('остатки по каждой валюте и месту сходятся', () => {
    expect(snapshot(holdings, B.vacation)).toEqual({
      'Копилка USD': usd(885),
      'Копилка EUR': eur(260),
      'Дебетовая карта USD': usd(43.75),
      'Накопительный BYN': byn(930),
      'Расчётный счёт BYN': byn(1750),
      'Евро-карта EUR': eur(385.4),
    });
  });
});
