import { describe, expect, it } from 'vitest';
import {
  buildExchange,
  buildLoanOut,
  buildMove,
  buildOpening,
  buildReallocate,
  newId,
} from '../../src/domain/operations.ts';
import { computeHoldings } from '../../src/domain/holdings.ts';
import { hasErrors, validateOperation } from '../../src/domain/validation.ts';
import { B, L, byn, currencies, locations, run, usd } from './fixtures.ts';

const ctx = { locations, currencies };

const codesOf = (draft: Parameters<typeof validateOperation>[0]) =>
  validateOperation(draft, ctx).map((i) => i.code);

/** Золотой тест 5 — инварианты раздела 4.3 ТЗ. */
describe('Золотой тест 5: валидация', () => {
  it('move с разными валютами отклоняется', () => {
    const draft = buildMove({
      date: '2025-03-03',
      bucketId: B.big,
      currency: 'BYN',
      amount: byn(95),
      fromLocationId: L.savings,
      toLocationId: L.piggy,
    });
    // Подменяем валюту у принимающей проводки — перемещение стало «обменом».
    draft.entries[1]!.currency = 'USD';

    const issues = validateOperation(draft, ctx);
    expect(hasErrors(issues)).toBe(true);
    expect(issues.map((i) => i.code)).toContain('move-currency');
    expect(issues.find((i) => i.code === 'move-currency')?.message).toMatch(/Обмен/);
  });

  it('exchange с одной валютой отклоняется', () => {
    const draft = buildExchange({
      date: '2025-03-03',
      bucketId: B.big,
      given: { locationId: L.savings, currency: 'BYN', amount: byn(880) },
      received: { locationId: L.cash, currency: 'BYN', amount: byn(880) },
    });

    expect(codesOf(draft)).toContain('exchange-currency');
  });

  it('reallocate с ненулевой суммой отклоняется', () => {
    const draft = buildReallocate({
      date: '2025-03-03',
      description: 'Кривой перевод',
      legs: [
        {
          fromBucketId: B.big,
          toBucketId: B.crypto,
          locationId: L.savings,
          currency: 'BYN',
          amount: byn(460),
        },
      ],
    });
    // Ломаем равновесие: пришло больше, чем ушло.
    draft.entries[1]!.amount = byn(610);

    const issues = validateOperation(draft, ctx);
    expect(hasErrors(issues)).toBe(true);
    expect(issues.map((i) => i.code)).toContain('nonzero-sum');
  });

  it('move внутри одного места отклоняется', () => {
    const draft = buildMove({
      date: '2025-03-03',
      bucketId: B.big,
      currency: 'BYN',
      amount: byn(95),
      fromLocationId: L.savings,
      toLocationId: L.savings,
    });
    expect(codesOf(draft)).toContain('move-same-location');
  });

  it('расход, размазанный по двум корзинам, отклоняется', () => {
    const draft = buildMove({
      date: '2025-03-03',
      bucketId: B.big,
      currency: 'BYN',
      amount: byn(95),
      fromLocationId: L.savings,
      toLocationId: L.cash,
    });
    draft.entries[1]!.bucketId = B.crypto;
    expect(codesOf(draft)).toContain('multi-bucket');
  });

  it('займ без контрагента отклоняется', () => {
    const draft = buildMove({
      date: '2025-03-03',
      bucketId: B.big,
      currency: 'BYN',
      amount: byn(95),
      fromLocationId: L.savings,
      toLocationId: L.cash,
    });
    const loan = { operation: { ...draft.operation, type: 'loan_out' as const }, entries: draft.entries };
    expect(codesOf(loan)).toContain('loan-no-counterparty');
  });

  it('корректировка без описания отклоняется', () => {
    const draft = buildOpening({
      date: '2025-03-03',
      description: '',
      lines: [
        { bucketId: B.big, locationId: L.savings, currency: 'BYN', amount: byn(15) },
      ],
    });
    const adjustment = {
      operation: { ...draft.operation, type: 'adjustment' as const, description: '  ' },
      entries: draft.entries,
    };
    expect(codesOf(adjustment)).toContain('no-description');
  });

  it('операция без проводок отклоняется', () => {
    const id = newId();
    const draft = {
      operation: {
        id,
        type: 'expense' as const,
        date: '2025-03-03',
        description: 'Пусто',
        createdAt: '2025-03-03T00:00:00.000Z',
        updatedAt: '2025-03-03T00:00:00.000Z',
      },
      entries: [],
    };
    expect(codesOf(draft)).toEqual(['no-entries']);
  });

  it('уход в минус предупреждает, но не блокирует', () => {
    const holdings = computeHoldings(
      buildOpening({
        date: '2025-03-03',
        lines: [
          { bucketId: B.big, locationId: L.savings, currency: 'BYN', amount: byn(55) },
        ],
      }).entries,
    );

    const draft = buildMove({
      date: '2025-03-04',
      bucketId: B.big,
      currency: 'BYN',
      amount: byn(85),
      fromLocationId: L.savings,
      toLocationId: L.cash,
    });

    const issues = validateOperation(draft, { ...ctx, holdings });
    expect(hasErrors(issues)).toBe(false);
    expect(issues.map((i) => i.code)).toContain('negative-holding');
    expect(issues[0]?.message).toContain('Накопительный');
  });

  it('корректный займ проходит и создаёт долг', () => {
    const { holdings, errors } = run([
      buildOpening({
        date: '2025-01-15',
        lines: [
          { bucketId: B.crypto, locationId: L.savings, currency: 'BYN', amount: byn(1780) },
        ],
      }),
      buildLoanOut({
        date: '2025-01-30',
        bucketId: B.crypto,
        currency: 'BYN',
        amount: byn(1320),
        fromLocationId: L.savings,
        counterpartyLocationId: L.debtAnya,
        description: 'Ане на телефон',
        dueDate: '2025-04-01',
      }),
    ]);

    expect(errors).toEqual([]);
    expect(
      holdings.find((h) => h.locationId === L.debtAnya)?.amount,
    ).toBe(byn(1320));
  });

  it('обмен в одну сторону (обе валюты в плюс) отклоняется', () => {
    const draft = buildExchange({
      date: '2025-03-03',
      bucketId: B.big,
      given: { locationId: L.savings, currency: 'BYN', amount: byn(880) },
      received: { locationId: L.fxCard, currency: 'USD', amount: usd(268.75) },
    });
    draft.entries[0]!.amount = Math.abs(draft.entries[0]!.amount);
    expect(codesOf(draft)).toContain('exchange-direction');
  });
});
