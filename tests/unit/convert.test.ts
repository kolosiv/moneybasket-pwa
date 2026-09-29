import { describe, expect, it } from 'vitest';
import { bynPerUnit, convertHoldings, latestRates } from '../../src/domain/convert.ts';
import { DEFAULT_CURRENCIES } from '../../src/domain/currencies.ts';
import { toMinor } from '../../src/domain/money.ts';
import type { Holding, Rate } from '../../src/domain/types.ts';

const currencies = DEFAULT_CURRENCIES;

const rates: Rate[] = [
  { date: '2025-03-01', currency: 'USD', bynPerUnit: 2.9, source: 'manual' },
  { date: '2025-03-10', currency: 'USD', bynPerUnit: 3.0, source: 'manual' },
  { date: '2025-03-10', currency: 'EUR', bynPerUnit: 3.5, source: 'manual' },
];

const holding = (currency: string, major: number): Holding => ({
  bucketId: 'b',
  locationId: 'l',
  currency,
  amount: toMinor(major, 2),
});

describe('latestRates', () => {
  it('берёт самый свежий курс по каждой валюте', () => {
    const latest = latestRates(rates);
    expect(latest.get('USD')?.bynPerUnit).toBe(3.0);
    expect(latest.get('EUR')?.bynPerUnit).toBe(3.5);
  });
});

describe('bynPerUnit', () => {
  const latest = latestRates(rates);

  it('для базовой валюты — единица', () => {
    expect(bynPerUnit('BYN', latest, currencies)).toBe(1);
  });

  it('USDT приравнивается к USD', () => {
    expect(bynPerUnit('USDT', latest, currencies)).toBe(3.0);
  });

  it('для неизвестной валюты — null, а не выдуманный курс', () => {
    expect(bynPerUnit('PLN', latest, currencies)).toBeNull();
  });
});

describe('convertHoldings', () => {
  it('сводит корзину в рубли', () => {
    const result = convertHoldings(
      [holding('BYN', 1400), holding('USD', 120), holding('EUR', 80)],
      'BYN',
      rates,
      currencies,
    );
    expect(result.amount).toBe(toMinor(1400 + 360 + 280, 2));
    expect(result.missing).toEqual([]);
  });

  it('сводит корзину в доллары', () => {
    const result = convertHoldings(
      [holding('BYN', 210), holding('USD', 65)],
      'USD',
      rates,
      currencies,
    );
    expect(result.amount).toBe(toMinor(135, 2));
  });

  it('сообщает о валютах без курса, а не молча их теряет', () => {
    const result = convertHoldings(
      [holding('BYN', 95), holding('PLN', 55)],
      'BYN',
      rates,
      currencies,
    );
    expect(result.amount).toBe(toMinor(95, 2));
    expect(result.missing).toEqual(['PLN']);
  });

  it('без курсов вообще не падает', () => {
    const result = convertHoldings([holding('USD', 55)], 'BYN', [], currencies);
    expect(result.amount).toBe(0);
    expect(result.missing).toEqual(['USD']);
  });
});
