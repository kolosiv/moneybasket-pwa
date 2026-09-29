import type { CurrencyCode, Rate } from './types.ts';

/**
 * Разбор ответа API Нацбанка. Вынесен в доменный слой отдельно от загрузки,
 * чтобы проверять его тестами без сети: сам API доступен не из любой точки.
 *
 * Ожидаемый ответ `GET /exrates/rates/{USD|EUR}?parammode=2`:
 * { "Cur_ID": 431, "Date": "2025-03-12T00:00:00", "Cur_Abbreviation": "USD",
 *   "Cur_Scale": 1, "Cur_Name": "Доллар США", "Cur_OfficialRate": 3.2145 }
 *
 * Курс указан за `Cur_Scale` единиц валюты, поэтому делим — у части валют
 * шкала равна 10 или 100.
 */
export class NbrbFormatError extends Error {}

export function parseNbrbRate(payload: unknown, expected: CurrencyCode): Rate {
  if (typeof payload !== 'object' || payload === null) {
    throw new NbrbFormatError('Нацбанк вернул не то, что ожидалось.');
  }
  const row = payload as Record<string, unknown>;

  const abbreviation = row['Cur_Abbreviation'];
  if (typeof abbreviation !== 'string' || abbreviation.toUpperCase() !== expected) {
    throw new NbrbFormatError(
      `Ожидали курс ${expected}, а пришёл ${String(abbreviation ?? 'неизвестно что')}.`,
    );
  }

  const official = row['Cur_OfficialRate'];
  if (typeof official !== 'number' || !Number.isFinite(official) || official <= 0) {
    throw new NbrbFormatError(`Нацбанк не дал курс ${expected}.`);
  }

  // Шкала необязательна: если её нет, считаем, что курс за одну единицу.
  const rawScale = row['Cur_Scale'];
  const scale = rawScale === undefined ? 1 : rawScale;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
    throw new NbrbFormatError(`Непонятная шкала курса ${expected}.`);
  }

  return {
    date: parseNbrbDate(row['Date']),
    currency: expected,
    bynPerUnit: official / scale,
    source: 'nbrb',
  };
}

/** `2025-03-12T00:00:00` → `2025-03-12`. Без даты курс бесполезен. */
function parseNbrbDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    throw new NbrbFormatError('В ответе Нацбанка нет даты курса.');
  }
  return value.slice(0, 10);
}

export function nbrbUrl(currency: CurrencyCode): string {
  return `https://api.nbrb.by/exrates/rates/${encodeURIComponent(currency)}?parammode=2`;
}
