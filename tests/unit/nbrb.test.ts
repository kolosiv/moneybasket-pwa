import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NbrbFormatError, nbrbUrl, parseNbrbRate } from '../../src/domain/nbrb.ts';
import {
  fetchNbrbRate,
  ratesAreFresh,
  refreshNbrbRates,
  syncRatesOnStart,
} from '../../src/db/nbrb.ts';
import { clearAllData } from '../../src/db/backup.ts';
import { listRates, putRate } from '../../src/db/repo.ts';
import { convertHoldings, latestRates } from '../../src/domain/convert.ts';
import { DEFAULT_CURRENCIES } from '../../src/domain/currencies.ts';
import { toMinor } from '../../src/domain/money.ts';

const usdPayload = {
  Cur_ID: 431,
  Date: '2025-03-12T00:00:00',
  Cur_Abbreviation: 'USD',
  Cur_Scale: 1,
  Cur_Name: 'Доллар США',
  Cur_OfficialRate: 3.2145,
};

describe('разбор ответа Нацбанка', () => {
  it('берёт курс и дату', () => {
    expect(parseNbrbRate(usdPayload, 'USD')).toEqual({
      date: '2025-03-12',
      currency: 'USD',
      bynPerUnit: 3.2145,
      source: 'nbrb',
    });
  });

  it('делит на шкалу — курс бывает указан за 100 единиц', () => {
    const rate = parseNbrbRate(
      { ...usdPayload, Cur_Abbreviation: 'JPY', Cur_Scale: 100, Cur_OfficialRate: 2.15 },
      'JPY',
    );
    expect(rate.bynPerUnit).toBeCloseTo(0.0215, 10);
  });

  it('без шкалы считает курс за одну единицу', () => {
    const { Cur_Scale: _scale, ...withoutScale } = usdPayload;
    expect(parseNbrbRate(withoutScale, 'USD').bynPerUnit).toBe(3.2145);
  });

  it('не принимает курс чужой валюты', () => {
    expect(() => parseNbrbRate(usdPayload, 'EUR')).toThrow(/Ожидали курс EUR/);
  });

  it('отвергает мусор вместо ответа', () => {
    for (const bad of [null, 'строка', 42, [], {}]) {
      expect(() => parseNbrbRate(bad, 'USD')).toThrow(NbrbFormatError);
    }
  });

  it('отвергает нечисловой, нулевой и отрицательный курс', () => {
    for (const rate of ['3.21', 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        parseNbrbRate({ ...usdPayload, Cur_OfficialRate: rate }, 'USD'),
      ).toThrow(/не дал курс/);
    }
  });

  it('отвергает битую шкалу', () => {
    expect(() => parseNbrbRate({ ...usdPayload, Cur_Scale: 0 }, 'USD')).toThrow(
      /шкала/,
    );
  });

  it('требует дату', () => {
    expect(() => parseNbrbRate({ ...usdPayload, Date: 'вчера' }, 'USD')).toThrow(
      /нет даты/,
    );
  });

  it('собирает правильный адрес запроса', () => {
    expect(nbrbUrl('USD')).toBe('https://api.nbrb.by/exrates/rates/USD?parammode=2');
  });
});

describe('загрузка курсов', () => {
  beforeEach(async () => {
    await clearAllData();
    vi.stubGlobal('navigator', { onLine: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  const ok = (payload: unknown) =>
    Promise.resolve({ ok: true, status: 200, json: async () => payload } as Response);

  it('сохраняет полученные курсы в базу', async () => {
    vi.stubGlobal('fetch', (url: string) =>
      ok(
        url.includes('EUR')
          ? { ...usdPayload, Cur_Abbreviation: 'EUR', Cur_OfficialRate: 3.7654 }
          : usdPayload,
      ),
    );

    const result = await refreshNbrbRates();
    expect(result.failed).toEqual([]);
    expect(result.updated).toHaveLength(2);

    const stored = latestRates(await listRates());
    expect(stored.get('USD')?.bynPerUnit).toBe(3.2145);
    expect(stored.get('EUR')?.bynPerUnit).toBe(3.7654);
    expect(stored.get('USD')?.source).toBe('nbrb');
  });

  it('падение сети не роняет обновление и объясняет причину', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));

    const result = await refreshNbrbRates();
    expect(result.updated).toEqual([]);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]!.reason).toMatch(/связаться с Нацбанком/);
    expect(await listRates()).toEqual([]);
  });

  it('одна валюта может не получиться, другая всё равно сохранится', async () => {
    vi.stubGlobal('fetch', (url: string) =>
      url.includes('EUR')
        ? Promise.resolve({ ok: false, status: 503 } as Response)
        : ok(usdPayload),
    );

    const result = await refreshNbrbRates();
    expect(result.updated.map((r) => r.currency)).toEqual(['USD']);
    expect(result.failed[0]).toMatchObject({ currency: 'EUR' });
    expect(result.failed[0]!.reason).toMatch(/503/);
  });

  it('ответ не в том формате не попадает в базу', async () => {
    vi.stubGlobal('fetch', () => ok({ Cur_Abbreviation: 'USD' }));
    const result = await refreshNbrbRates(['USD']);
    expect(result.updated).toEqual([]);
    expect(await listRates()).toEqual([]);
  });

  it('невалидный JSON обрабатывается как ошибка формата', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      } as unknown as Response),
    );
    await expect(fetchNbrbRate('USD')).rejects.toThrow(/не разобрался как JSON/);
  });
});

describe('обновление при запуске', () => {
  beforeEach(async () => {
    await clearAllData();
    vi.stubGlobal('navigator', { onLine: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('не ходит в сеть, если курсы за сегодня уже есть', async () => {
    await putRate({ date: '2025-03-12', currency: 'USD', bynPerUnit: 3.2, source: 'manual' });
    await putRate({ date: '2025-03-12', currency: 'EUR', bynPerUnit: 3.7, source: 'manual' });
    expect(await ratesAreFresh('2025-03-12')).toBe(true);

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await syncRatesOnStart('2025-03-12');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('обновляет, если курс вчерашний', async () => {
    await putRate({ date: '2025-03-11', currency: 'USD', bynPerUnit: 3.2, source: 'nbrb' });
    expect(await ratesAreFresh('2025-03-12')).toBe(false);

    const fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: async () => usdPayload } as Response),
    );
    vi.stubGlobal('fetch', fetchSpy);
    await syncRatesOnStart('2025-03-12');
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('офлайн не трогает сеть и не бросает', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(syncRatesOnStart('2025-03-12')).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ручной курс не затирается, если Нацбанк недоступен', async () => {
    await putRate({ date: '2025-03-10', currency: 'USD', bynPerUnit: 3.1, source: 'manual' });
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));

    await syncRatesOnStart('2025-03-12');

    const stored = latestRates(await listRates());
    expect(stored.get('USD')).toMatchObject({ bynPerUnit: 3.1, source: 'manual' });
  });
});

describe('курсы доходят до пересчёта на главной', () => {
  beforeEach(async () => {
    await clearAllData();
    vi.stubGlobal('navigator', { onLine: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('после загрузки корзина считается в долларах', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: true, status: 200, json: async () => usdPayload } as Response),
    );
    await refreshNbrbRates(['USD']);

    const holdings = [
      { bucketId: 'b', locationId: 'l', currency: 'BYN', amount: toMinor(321.45, 2) },
    ];
    const result = convertHoldings(
      holdings,
      'USD',
      await listRates(),
      DEFAULT_CURRENCIES,
    );
    expect(result.amount).toBe(toMinor(100, 2));
    expect(result.missing).toEqual([]);
  });
});
