import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatMoney,
  parseAmount,
  sumAmounts,
  toMinor,
} from '../../src/domain/money.ts';

const NBSP = ' ';

describe('parseAmount', () => {
  it('принимает и запятую, и точку', () => {
    expect(parseAmount('18,4', 2)).toBe(1840);
    expect(parseAmount('18.4', 2)).toBe(1840);
  });

  it('принимает разделители разрядов', () => {
    expect(parseAmount('1 234,56', 2)).toBe(123_456);
    expect(parseAmount(`1${NBSP}234,56`, 2)).toBe(123_456);
  });

  it('дописывает недостающие знаки', () => {
    expect(parseAmount('640', 2)).toBe(64_000);
    expect(parseAmount('0,5', 2)).toBe(50);
    expect(parseAmount(',5', 2)).toBe(50);
  });

  it('округляет лишние знаки half-up', () => {
    expect(parseAmount('1,005', 2)).toBe(101);
    expect(parseAmount('6,004', 2)).toBe(600);
    expect(parseAmount('5,999', 2)).toBe(600);
  });

  it('понимает отрицательные суммы', () => {
    expect(parseAmount('-18,4', 2)).toBe(-1840);
  });

  it('возвращает null на мусоре', () => {
    for (const bad of ['', '  ', '-', 'abc', '1,2,3', '12р', '1e5']) {
      expect(parseAmount(bad, 2), bad).toBeNull();
    }
  });

  it('работает с валютой без дробной части', () => {
    expect(parseAmount('1400', 0)).toBe(1400);
    expect(parseAmount('1500,6', 0)).toBe(1501);
  });
});

describe('formatAmount', () => {
  it('форматирует по-русски с неразрывным пробелом', () => {
    expect(formatAmount(123_456, 2)).toBe(`1${NBSP}234,56`);
    expect(formatAmount(100_000_000, 2)).toBe(`1${NBSP}000${NBSP}000,00`);
  });

  it('всегда показывает знаки после запятой', () => {
    expect(formatAmount(64_000, 2)).toBe('640,00');
    expect(formatAmount(5, 2)).toBe('0,05');
  });

  it('использует настоящий минус, а не дефис', () => {
    expect(formatAmount(-1840, 2)).toBe('−' + '18,40');
  });

  it('добавляет символ валюты', () => {
    expect(formatMoney(123_456, { symbol: 'р', decimals: 2 })).toBe(
      `1${NBSP}234,56${NBSP}р`,
    );
  });
});

describe('целочисленная арифметика', () => {
  it('не накапливает ошибку float на типичных суммах', () => {
    const total = sumAmounts([
      toMinor(1284.36, 2),
      toMinor(280, 2),
      -toMinor(15.5, 2),
      toMinor(85, 2),
      -toMinor(18.4, 2),
      -toMinor(645.3, 2),
      -toMinor(8, 2),
      -toMinor(19.9, 2),
    ]);
    expect(total).toBe(toMinor(942.26, 2));
    expect(formatAmount(total, 2)).toBe(`942,26`);
  });

  it('0,1 + 0,2 даёт ровно 0,3', () => {
    expect(parseAmount('0,1', 2)! + parseAmount('0,2', 2)!).toBe(
      parseAmount('0,3', 2),
    );
  });
});
