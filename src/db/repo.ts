import { db } from './db.ts';
import { computeHoldings, liveEntries } from '../domain/holdings.ts';
import type {
  Bucket,
  Currency,
  Entry,
  Holding,
  Location,
  Operation,
  OperationDraft,
  Rate,
  Settings,
} from '../domain/types.ts';
import { defaultSettings } from './seed.ts';

// ─── справочники ────────────────────────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('settings')) ?? defaultSettings();
}

export async function patchSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: 'settings' });
}

export async function isOnboarded(): Promise<boolean> {
  const settings = await db.settings.get('settings');
  return settings?.onboardedAt !== undefined;
}

/** Живые (неархивные) справочники в порядке сортировки. */
export async function activeBuckets(): Promise<Bucket[]> {
  const all = await db.buckets.toArray();
  return all.filter((b) => !b.archived).sort((a, b) => a.sort - b.sort);
}

export async function activeLocations(): Promise<Location[]> {
  const all = await db.locations.toArray();
  return all.filter((l) => !l.archived).sort((a, b) => a.sort - b.sort);
}

export async function allCurrencies(): Promise<Currency[]> {
  const all = await db.currencies.toArray();
  return all.sort((a, b) => a.sort - b.sort);
}

// ─── операции ───────────────────────────────────────────────────────────────

/** Операции без удалённых, свежие сверху. */
export async function listOperations(): Promise<Operation[]> {
  const all = await db.operations.toArray();
  return all
    .filter((o) => o.deletedAt === undefined)
    .sort((a, b) =>
      a.date === b.date
        ? b.createdAt.localeCompare(a.createdAt)
        : b.date.localeCompare(a.date),
    );
}

/** Мягко удалённые операции, свежие сверху — чтобы их можно было вернуть. */
export async function listDeletedOperations(): Promise<Operation[]> {
  const all = await db.operations.toArray();
  return all
    .filter((o) => o.deletedAt !== undefined)
    .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
}

export async function getOperation(
  id: string,
): Promise<OperationDraft | undefined> {
  const operation = await db.operations.get(id);
  if (!operation) return undefined;
  const entries = await db.entries.where('operationId').equals(id).toArray();
  return { operation, entries };
}

/** Сохраняет операцию вместе с проводками одной транзакцией. */
export async function saveOperation(draft: OperationDraft): Promise<void> {
  await db.transaction('rw', db.operations, db.entries, async () => {
    await db.entries.where('operationId').equals(draft.operation.id).delete();
    await db.operations.put(draft.operation);
    await db.entries.bulkPut(draft.entries as Entry[]);
  });
}

export async function saveOperations(
  drafts: readonly OperationDraft[],
): Promise<void> {
  await db.transaction('rw', db.operations, db.entries, async () => {
    await db.operations.bulkPut(drafts.map((d) => d.operation));
    await db.entries.bulkPut(drafts.flatMap((d) => d.entries));
  });
}

/** Мягкое удаление — проводки остаются, но в расчёт не идут. */
export async function softDeleteOperation(id: string): Promise<void> {
  await db.operations.update(id, { deletedAt: new Date().toISOString() });
}

export async function restoreOperation(id: string): Promise<void> {
  const operation = await db.operations.get(id);
  if (!operation) return;
  const { deletedAt: _deleted, ...rest } = operation;
  await db.operations.put({ ...rest, updatedAt: new Date().toISOString() });
}

// ─── остатки ────────────────────────────────────────────────────────────────

export async function loadHoldings(): Promise<Holding[]> {
  const [operations, entries] = await Promise.all([
    db.operations.toArray(),
    db.entries.toArray(),
  ]);
  return computeHoldings(liveEntries(entries, operations));
}

/** Проводки живых операций — основа для любых расчётов в UI. */
export async function loadLiveEntries(): Promise<Entry[]> {
  const [operations, entries] = await Promise.all([
    db.operations.toArray(),
    db.entries.toArray(),
  ]);
  return liveEntries(entries, operations);
}

// ─── курсы ──────────────────────────────────────────────────────────────────

export async function listRates(): Promise<Rate[]> {
  return db.rates.toArray();
}

export async function putRate(rate: Rate): Promise<void> {
  await db.rates.put(rate);
}

// ─── автодополнение описаний ────────────────────────────────────────────────

/** Прошлые описания по убыванию частоты — для подсказок в быстром вводе. */
export async function recentDescriptions(limit = 200): Promise<string[]> {
  const operations = await listOperations();
  const counts = new Map<string, number>();
  for (const op of operations) {
    const text = op.description.trim();
    if (text === '') continue;
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([text]) => text);
}
