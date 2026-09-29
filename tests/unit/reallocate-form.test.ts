import { describe, expect, it } from 'vitest';
import { makeFormat } from '../../src/app/format.ts';
import { DEFAULT_CURRENCIES } from '../../src/domain/currencies.ts';
import { computeHoldings } from '../../src/domain/holdings.ts';
import { toMinor } from '../../src/domain/money.ts';
import { hasErrors, validateOperation } from '../../src/domain/validation.ts';
import { buildDraft, formFromDraft, initialForm } from '../../src/features/entry/state.ts';
import type { Location } from '../../src/domain/types.ts';

const format = makeFormat(DEFAULT_CURRENCIES);
const m = (major: number) => toMinor(major, 2);

const UNALLOCATED = 'b-unallocated';
const VACATION = 'b-vacation';
const BIG = 'b-big';
const CRYPTO = 'b-crypto';
const SAFE = 'l-safe';
const CARD = 'l-card';

const locations: Location[] = [
  { id: SAFE, name: 'Накопительный', kind: 'bank', archived: false, sort: 0 },
  { id: CARD, name: 'Валютная карта', kind: 'bank', archived: false, sort: 1 },
];

const base = (patch: Partial<ReturnType<typeof initialForm>> = {}) =>
  initialForm({ type: 'reallocate', date: '2025-03-12', ...patch });

describe('перевод между корзинами', () => {
  it('раскладывает отпускные из «Нераспределено» в Отпуск', () => {
    const form = base({
      bucketId: UNALLOCATED,
      toBucketId: VACATION,
      description: 'Отпускные в отпуск',
      from: { id: 'a', locationId: SAFE, currency: 'BYN', amount: '2861,35' },
    });

    const { draft, problem } = buildDraft(form, format);
    expect(problem).toBeUndefined();
    expect(draft).toBeDefined();

    const issues = validateOperation(draft!, { locations, currencies: DEFAULT_CURRENCIES });
    expect(hasErrors(issues)).toBe(false);

    expect(draft!.entries).toHaveLength(2);
    const holdings = computeHoldings(draft!.entries);
    expect(
      holdings.find((h) => h.bucketId === UNALLOCATED)?.amount,
    ).toBe(-m(2861.35));
    expect(holdings.find((h) => h.bucketId === VACATION)?.amount).toBe(m(2861.35));
  });

  it('раскладывает часть суммы, остальное остаётся нераспределённым', () => {
    const form = base({
      bucketId: UNALLOCATED,
      toBucketId: BIG,
      from: { id: 'a', locationId: SAFE, currency: 'BYN', amount: '640' },
    });

    const { draft } = buildDraft(form, format);
    const holdings = computeHoldings(draft!.entries);
    expect(holdings.find((h) => h.bucketId === BIG)?.amount).toBe(m(640));
    expect(holdings.find((h) => h.bucketId === UNALLOCATED)?.amount).toBe(-m(640));
  });

  it('встречный обмен: два плеча в разных валютах, итог по каждой нулевой', () => {
    // КП продаёт 275,40 $ Крипте за 820 р.
    const form = base({
      bucketId: BIG,
      toBucketId: CRYPTO,
      description: 'Продаю доллары Крипте',
      from: { id: 'a', locationId: CARD, currency: 'USD', amount: '275,40' },
      counter: { id: 'b', locationId: SAFE, currency: 'BYN', amount: '820' },
    });

    const { draft, problem } = buildDraft(form, format);
    expect(problem).toBeUndefined();
    expect(draft!.entries).toHaveLength(4);

    const issues = validateOperation(draft!, { locations, currencies: DEFAULT_CURRENCIES });
    expect(hasErrors(issues)).toBe(false);

    const byCurrency = (code: string) =>
      draft!.entries
        .filter((e) => e.currency === code)
        .reduce((sum, e) => sum + e.amount, 0);
    expect(byCurrency('USD')).toBe(0);
    expect(byCurrency('BYN')).toBe(0);

    const holdings = computeHoldings(draft!.entries);
    const at = (bucketId: string, currency: string) =>
      holdings.find((h) => h.bucketId === bucketId && h.currency === currency)?.amount;
    expect(at(BIG, 'USD')).toBe(-m(275.4));
    expect(at(CRYPTO, 'USD')).toBe(m(275.4));
    expect(at(CRYPTO, 'BYN')).toBe(-m(820));
    expect(at(BIG, 'BYN')).toBe(m(820));
  });

  it('не даёт перевести корзину саму в себя', () => {
    const form = base({
      bucketId: BIG,
      toBucketId: BIG,
      from: { id: 'a', locationId: SAFE, currency: 'BYN', amount: '95' },
    });
    expect(buildDraft(form, format).problem).toBe('Корзины должны быть разными');
  });

  it('требует выбрать корзину назначения, место и сумму', () => {
    expect(buildDraft(base({ bucketId: BIG }), format).problem).toBe(
      'Выберите, в какую корзину',
    );
    expect(
      buildDraft(base({ bucketId: BIG, toBucketId: CRYPTO }), format).problem,
    ).toBe('Выберите место');
    expect(
      buildDraft(
        base({
          bucketId: BIG,
          toBucketId: CRYPTO,
          from: { id: 'a', locationId: SAFE, currency: 'BYN', amount: '' },
        }),
        format,
      ).problem,
    ).toBe('Введите сумму');
  });

  it('ругается на недозаполненную встречную часть', () => {
    const form = base({
      bucketId: BIG,
      toBucketId: CRYPTO,
      from: { id: 'a', locationId: CARD, currency: 'USD', amount: '275,40' },
      counter: { id: 'b', locationId: '', currency: 'BYN', amount: '820' },
    });
    expect(buildDraft(form, format).problem).toBe('Выберите место встречной части');
  });

  it('редактирование восстанавливает оба плеча', () => {
    const form = base({
      bucketId: BIG,
      toBucketId: CRYPTO,
      description: 'Продаю доллары Крипте',
      from: { id: 'a', locationId: CARD, currency: 'USD', amount: '275,40' },
      counter: { id: 'b', locationId: SAFE, currency: 'BYN', amount: '820' },
    });
    const { draft } = buildDraft(form, format);

    const restored = formFromDraft(draft!, locations, format);
    expect(restored).not.toBeNull();
    expect(restored!.type).toBe('reallocate');
    expect(restored!.bucketId).toBe(BIG);
    expect(restored!.toBucketId).toBe(CRYPTO);
    expect(restored!.from.locationId).toBe(CARD);
    expect(restored!.from.currency).toBe('USD');
    expect(restored!.from.amount).toBe('275,40');
    expect(restored!.counter.currency).toBe('BYN');
    expect(restored!.counter.amount).toBe('820,00');
  });

  it('редактирование одностороннего перевода не выдумывает встречную часть', () => {
    const form = base({
      bucketId: UNALLOCATED,
      toBucketId: VACATION,
      from: { id: 'a', locationId: SAFE, currency: 'BYN', amount: '2861,35' },
    });
    const { draft } = buildDraft(form, format);
    const restored = formFromDraft(draft!, locations, format);
    expect(restored!.counter.amount).toBe('');
    expect(restored!.bucketId).toBe(UNALLOCATED);
    expect(restored!.toBucketId).toBe(VACATION);
  });
});
