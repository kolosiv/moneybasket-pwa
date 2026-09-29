import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db.ts';
import {
  activeBuckets,
  activeLocations,
  allCurrencies,
  getSettings,
  listOperations,
  listRates,
  loadHoldings,
  recentDescriptions,
} from './repo.ts';
import { defaultSettings } from './seed.ts';
import type {
  Bucket,
  Currency,
  Holding,
  Location,
  Operation,
  Rate,
  Settings,
} from '../domain/types.ts';

/**
 * `undefined` из useLiveQuery означает «ещё грузится», и это важно отличать
 * от пустого списка: иначе на первом кадре главная мигает онбордингом.
 */
export function useBuckets(): Bucket[] | undefined {
  return useLiveQuery(() => activeBuckets(), []);
}

export function useAllBuckets(): Bucket[] | undefined {
  return useLiveQuery(() => db.buckets.toArray().then(sortBySort), []);
}

export function useLocations(): Location[] | undefined {
  return useLiveQuery(() => activeLocations(), []);
}

export function useAllLocations(): Location[] | undefined {
  return useLiveQuery(() => db.locations.toArray().then(sortBySort), []);
}

export function useCurrencies(): Currency[] | undefined {
  return useLiveQuery(() => allCurrencies(), []);
}

export function useHoldings(): Holding[] | undefined {
  return useLiveQuery(() => loadHoldings(), []);
}

export function useOperations(): Operation[] | undefined {
  return useLiveQuery(() => listOperations(), []);
}

export function useRates(): Rate[] | undefined {
  return useLiveQuery(() => listRates(), []);
}

export function useSettings(): Settings {
  return useLiveQuery(() => getSettings(), [], defaultSettings());
}

export function useDescriptions(): string[] {
  return useLiveQuery(() => recentDescriptions(), [], []);
}

function sortBySort<T extends { sort: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.sort - b.sort);
}
