import { NbrbFormatError, nbrbUrl, parseNbrbRate } from '../domain/nbrb.ts';
import { latestRates } from '../domain/convert.ts';
import type { CurrencyCode, Rate } from '../domain/types.ts';
import { listRates, putRate } from './repo.ts';

/** Валюты, по которым имеет смысл спрашивать Нацбанк. USDT приравнен к USD. */
export const NBRB_CURRENCIES: CurrencyCode[] = ['USD', 'EUR'];

const TIMEOUT_MS = 8000;

export interface RefreshResult {
  updated: Rate[];
  failed: { currency: CurrencyCode; reason: string }[];
}

/**
 * Тянет курс одной валюты. Единственный внешний запрос во всём приложении.
 * Бросает понятную ошибку — вызывающий решает, показывать её или промолчать.
 */
export async function fetchNbrbRate(currency: CurrencyCode): Promise<Rate> {
  let response: Response;
  try {
    response = await fetch(nbrbUrl(currency), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Нацбанку не нужны ни куки, ни лишние заголовки: так запрос остаётся
      // простым и не требует preflight.
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    // Сюда же попадает и блокировка CORS: браузер не даёт отличить её от
    // сетевой ошибки, поэтому формулировка общая.
    throw new NbrbFormatError(
      'Не удалось связаться с Нацбанком. Проверьте интернет или введите курс вручную.',
    );
  }

  if (!response.ok) {
    throw new NbrbFormatError(`Нацбанк ответил ошибкой ${response.status}.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new NbrbFormatError('Ответ Нацбанка не разобрался как JSON.');
  }

  return parseNbrbRate(payload, currency);
}

/**
 * Обновляет курсы и складывает их в базу. Никогда не бросает: неудача по
 * одной валюте не должна мешать остальным и тем более ронять экран.
 */
export async function refreshNbrbRates(
  currencies: readonly CurrencyCode[] = NBRB_CURRENCIES,
): Promise<RefreshResult> {
  const result: RefreshResult = { updated: [], failed: [] };

  const settled = await Promise.allSettled(
    currencies.map(async (currency) => {
      const rate = await fetchNbrbRate(currency);
      await putRate(rate);
      return rate;
    }),
  );

  settled.forEach((outcome, index) => {
    const currency = currencies[index]!;
    if (outcome.status === 'fulfilled') result.updated.push(outcome.value);
    else {
      const error: unknown = outcome.reason;
      result.failed.push({
        currency,
        reason: error instanceof Error ? error.message : 'Неизвестная ошибка.',
      });
    }
  });

  return result;
}

/** Есть ли уже курс на сегодня — чтобы не дёргать API лишний раз. */
export async function ratesAreFresh(
  today: string,
  currencies: readonly CurrencyCode[] = NBRB_CURRENCIES,
): Promise<boolean> {
  const latest = latestRates(await listRates());
  return currencies.every((code) => (latest.get(code)?.date ?? '') >= today);
}

/**
 * Тихое обновление при запуске: если курсы за сегодня уже есть или сети нет,
 * ничего не делаем и молчим. Ручная кнопка в настройках сообщает об ошибках.
 */
export async function syncRatesOnStart(today: string): Promise<void> {
  try {
    if (!navigator.onLine) return;
    if (await ratesAreFresh(today)) return;
    await refreshNbrbRates();
  } catch {
    // Курс — удобство, а не условие работы приложения.
  }
}
