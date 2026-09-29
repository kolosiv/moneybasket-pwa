import { useMemo } from 'react';
import {
  useBuckets,
  useCurrencies,
  useHoldings,
  useLocations,
  useRates,
  useSettings,
} from '../db/hooks.ts';
import { makeFormat, type Format } from './format.ts';
import { convertHoldings } from '../domain/convert.ts';
import { byBucket } from '../domain/holdings.ts';
import type {
  Bucket,
  CurrencyCode,
  Holding,
  Location,
  Settings,
} from '../domain/types.ts';

export interface AppData {
  ready: boolean;
  buckets: Bucket[];
  locations: Location[];
  holdings: Holding[];
  settings: Settings;
  format: Format;
  bucketOf: Map<string, Bucket>;
  locationOf: Map<string, Location>;
  holdingsByBucket: Map<string, Holding[]>;
  /** Сводит позиции в валюту. `null` — курса не хватает, показывать нечего. */
  convert: (holdings: readonly Holding[], target: CurrencyCode) => number | null;
}

export function useAppData(): AppData {
  const buckets = useBuckets();
  const locations = useLocations();
  const currencies = useCurrencies();
  const holdings = useHoldings();
  const rates = useRates();
  const settings = useSettings();

  return useMemo(() => {
    const ready =
      buckets !== undefined &&
      locations !== undefined &&
      currencies !== undefined &&
      holdings !== undefined &&
      rates !== undefined;

    const safeBuckets = buckets ?? [];
    const safeLocations = locations ?? [];
    const safeCurrencies = currencies ?? [];
    const safeHoldings = holdings ?? [];
    const safeRates = rates ?? [];

    return {
      ready,
      buckets: safeBuckets,
      locations: safeLocations,
      holdings: safeHoldings,
      settings,
      format: makeFormat(safeCurrencies),
      bucketOf: new Map(safeBuckets.map((b) => [b.id, b])),
      locationOf: new Map(safeLocations.map((l) => [l.id, l])),
      holdingsByBucket: byBucket(safeHoldings),
      convert(subset, target) {
        if (subset.length === 0) return 0;
        const result = convertHoldings(
          subset,
          target,
          safeRates,
          safeCurrencies,
          settings.baseCurrency,
        );
        return result.missing.length > 0 && result.amount === 0 ? null : result.amount;
      },
    };
  }, [buckets, locations, currencies, holdings, rates, settings]);
}

/** Позиции корзины в порядке показа: сначала реальные места, долги в конце. */
export function sortHoldings(
  holdings: readonly Holding[],
  locationOf: Map<string, Location>,
): Holding[] {
  return [...holdings].sort((a, b) => {
    const la = locationOf.get(a.locationId);
    const lb = locationOf.get(b.locationId);
    const receivableA = la?.kind === 'receivable' ? 1 : 0;
    const receivableB = lb?.kind === 'receivable' ? 1 : 0;
    if (receivableA !== receivableB) return receivableA - receivableB;
    if ((la?.sort ?? 0) !== (lb?.sort ?? 0)) return (la?.sort ?? 0) - (lb?.sort ?? 0);
    return a.currency.localeCompare(b.currency);
  });
}
