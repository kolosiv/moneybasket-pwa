import { describe, expect, it } from 'vitest';
import {
  buildExpense,
  buildLoanReturn,
  buildMove,
  buildOpening,
} from '../../src/domain/operations.ts';
import { holdingAmount } from '../../src/domain/holdings.ts';
import { B, L, byn, eur, run, snapshot, usd } from './fixtures.ts';

/**
 * Золотой тест 1 — «Крупные покупки»: перемещение между местами, расходы,
 * раздельная оплата, займ и его возврат. Сумма считается до копейки.
 */
describe('Золотой тест 1: Крупные покупки', () => {
  const operations = [
    buildOpening({
      date: '2025-02-28',
      lines: [
        { bucketId: B.big, locationId: L.savings, currency: 'BYN', amount: byn(1284.36) },
        { bucketId: B.big, locationId: L.cash, currency: 'BYN', amount: byn(760) },
        { bucketId: B.big, locationId: L.debtAnya, currency: 'BYN', amount: byn(85) },
        { bucketId: B.big, locationId: L.debtBrother, currency: 'BYN', amount: byn(120) },
        { bucketId: B.big, locationId: L.dacha, currency: 'USD', amount: usd(410) },
        { bucketId: B.big, locationId: L.piggy, currency: 'USD', amount: usd(385) },
        { bucketId: B.big, locationId: L.piggy, currency: 'EUR', amount: eur(175) },
      ],
    }),

    // Перемещение с налички на накопительный счёт
    buildMove({
      date: '2025-03-03',
      bucketId: B.big,
      currency: 'BYN',
      amount: byn(280),
      fromLocationId: L.cash,
      toLocationId: L.savings,
      description: 'С налички на накопительный',
    }),

    // Расход с одного места
    buildExpense({
      date: '2025-03-04',
      bucketId: B.big,
      description: 'Канцтовары',
      lines: [{ locationId: L.savings, currency: 'BYN', amount: byn(15.5) }],
    }),

    // Возврат займа: долг закрывается целиком
    buildLoanReturn({
      date: '2025-03-05',
      bucketId: B.big,
      currency: 'BYN',
      amount: byn(85),
      toLocationId: L.savings,
      counterpartyLocationId: L.debtAnya,
      description: 'Аня вернула',
    }),

    buildExpense({
      date: '2025-03-07',
      bucketId: B.big,
      description: 'Такси',
      lines: [{ locationId: L.savings, currency: 'BYN', amount: byn(18.4) }],
    }),

    buildExpense({
      date: '2025-03-08',
      bucketId: B.big,
      description: 'Отель',
      lines: [{ locationId: L.savings, currency: 'BYN', amount: byn(645.3) }],
    }),

    // Раздельная оплата: 128 = 120 наличкой + 8 с накопительного
    buildExpense({
      date: '2025-03-10',
      bucketId: B.big,
      description: 'Цветы',
      lines: [
        { locationId: L.cash, currency: 'BYN', amount: byn(120) },
        { locationId: L.savings, currency: 'BYN', amount: byn(8) },
      ],
    }),

    buildExpense({
      date: '2025-03-11',
      bucketId: B.big,
      description: 'Такси',
      lines: [{ locationId: L.savings, currency: 'BYN', amount: byn(19.9) }],
    }),
  ];

  const { holdings, errors, warnings } = run(operations);

  it('проходит без ошибок и предупреждений', () => {
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('остатки после всех операций сходятся до копейки', () => {
    expect(snapshot(holdings, B.big)).toEqual({
      'Накопительный BYN': byn(942.26),
      'Наличка BYN': byn(360),
      'Долг: Брат BYN': byn(120),
      'Дача USD': usd(410),
      'Копилка USD': usd(385),
      'Копилка EUR': eur(175),
    });
  });

  it('закрытый займ в списке позиций не висит', () => {
    expect(holdingAmount(holdings, B.big, L.debtAnya, 'BYN')).toBe(0);
    expect(holdings.some((h) => h.locationId === L.debtAnya)).toBe(false);
  });

  it('открытый займ остаётся открытым', () => {
    expect(holdingAmount(holdings, B.big, L.debtBrother, 'BYN')).toBe(byn(120));
  });
});
