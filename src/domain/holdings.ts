import type { CurrencyCode, Entry, Holding, Operation } from './types.ts';

/** Ключ позиции. Id — uuid, двоеточий не содержат, так что склейка однозначна. */
export function holdingKey(
  bucketId: string,
  locationId: string,
  currency: CurrencyCode,
): string {
  return `${bucketId}::${locationId}::${currency}`;
}

/** Отбрасывает проводки мягко удалённых операций. */
export function liveEntries(
  entries: readonly Entry[],
  operations: readonly Operation[],
): Entry[] {
  const deleted = new Set(
    operations.filter((o) => o.deletedAt !== undefined).map((o) => o.id),
  );
  return deleted.size === 0
    ? [...entries]
    : entries.filter((e) => !deleted.has(e.operationId));
}

/**
 * Остатки по тройке корзина × место × валюта.
 * Нулевые позиции отбрасываются: закрытый займ не должен висеть в списке.
 */
export function computeHoldings(entries: readonly Entry[]): Holding[] {
  const acc = new Map<string, Holding>();
  for (const e of entries) {
    const key = holdingKey(e.bucketId, e.locationId, e.currency);
    const existing = acc.get(key);
    if (existing) {
      existing.amount += e.amount;
    } else {
      acc.set(key, {
        bucketId: e.bucketId,
        locationId: e.locationId,
        currency: e.currency,
        amount: e.amount,
      });
    }
  }
  return [...acc.values()].filter((h) => h.amount !== 0);
}

/** Остаток конкретной позиции; 0, если позиции нет. */
export function holdingAmount(
  holdings: readonly Holding[],
  bucketId: string,
  locationId: string,
  currency: CurrencyCode,
): number {
  return (
    holdings.find(
      (h) =>
        h.bucketId === bucketId &&
        h.locationId === locationId &&
        h.currency === currency,
    )?.amount ?? 0
  );
}

function groupBy(
  holdings: readonly Holding[],
  pick: (h: Holding) => string,
): Map<string, Holding[]> {
  const out = new Map<string, Holding[]>();
  for (const h of holdings) {
    const key = pick(h);
    const list = out.get(key);
    if (list) list.push(h);
    else out.set(key, [h]);
  }
  return out;
}

export function byBucket(holdings: readonly Holding[]): Map<string, Holding[]> {
  return groupBy(holdings, (h) => h.bucketId);
}

export function byLocation(holdings: readonly Holding[]): Map<string, Holding[]> {
  return groupBy(holdings, (h) => h.locationId);
}

/** Суммы по валютам внутри набора позиций. */
export function totalsByCurrency(
  holdings: readonly Holding[],
): Map<CurrencyCode, number> {
  const out = new Map<CurrencyCode, number>();
  for (const h of holdings) {
    out.set(h.currency, (out.get(h.currency) ?? 0) + h.amount);
  }
  for (const [code, amount] of out) if (amount === 0) out.delete(code);
  return out;
}
