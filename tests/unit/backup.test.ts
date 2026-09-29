import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BackupFormatError,
  backupIsStale,
  clearAllData,
  exportBackup,
  importBackup,
  parseBackup,
} from '../../src/db/backup.ts';
import { db } from '../../src/db/db.ts';
import {
  loadHoldings,
  saveOperation,
  softDeleteOperation,
} from '../../src/db/repo.ts';
import {
  defaultBuckets,
  defaultCurrencies,
  defaultLocations,
  defaultSettings,
} from '../../src/db/seed.ts';
import { buildExpense, buildOpening } from '../../src/domain/operations.ts';
import { toMinor } from '../../src/domain/money.ts';

const byn = (major: number) => toMinor(major, 2);

async function seedRealisticData() {
  const buckets = defaultBuckets();
  const locations = defaultLocations();
  const big = buckets[0]!;
  const safe = locations[0]!;

  await db.buckets.bulkPut(buckets);
  await db.locations.bulkPut(locations);
  await db.currencies.bulkPut(defaultCurrencies());
  await db.settings.put({ ...defaultSettings(), onboardedAt: '2025-03-01T00:00:00.000Z' });

  await saveOperation(
    buildOpening({
      date: '2025-02-28',
      lines: [
        { bucketId: big.id, locationId: safe.id, currency: 'BYN', amount: byn(1284.36) },
      ],
    }),
  );
  await saveOperation(
    buildExpense({
      date: '2025-03-04',
      bucketId: big.id,
      description: 'Такси',
      lines: [{ locationId: safe.id, currency: 'BYN', amount: byn(18.4) }],
    }),
  );

  return { big, safe };
}

describe('экспорт и импорт', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('экспорт → очистка → импорт возвращает всё как было', async () => {
    const { big, safe } = await seedRealisticData();
    const before = await loadHoldings();
    expect(before).toHaveLength(1);
    expect(before[0]!.amount).toBe(byn(1265.96));

    const backup = await exportBackup();
    const text = JSON.stringify(backup);

    await clearAllData();
    expect(await loadHoldings()).toEqual([]);
    expect(await db.operations.count()).toBe(0);

    await importBackup(parseBackup(text));

    const after = await loadHoldings();
    expect(after).toEqual(before);
    expect(await db.operations.count()).toBe(2);
    expect(await db.buckets.count()).toBe(4);
    expect((await db.settings.get('settings'))?.onboardedAt).toBe(
      '2025-03-01T00:00:00.000Z',
    );
    expect(
      after.find((h) => h.bucketId === big.id && h.locationId === safe.id)?.amount,
    ).toBe(byn(1265.96));
  });

  it('удалённые операции переживают round-trip и остаются вне расчёта', async () => {
    await seedRealisticData();
    const expense = (await db.operations.toArray()).find((o) => o.type === 'expense')!;
    await softDeleteOperation(expense.id);

    const holdingsBefore = await loadHoldings();
    expect(holdingsBefore[0]!.amount).toBe(byn(1284.36));

    const text = JSON.stringify(await exportBackup());
    await clearAllData();
    await importBackup(parseBackup(text));

    expect(await loadHoldings()).toEqual(holdingsBefore);
    expect((await db.operations.get(expense.id))?.deletedAt).toBeDefined();
  });

  it('импорт полностью заменяет данные, а не подмешивает', async () => {
    await seedRealisticData();
    const text = JSON.stringify(await exportBackup());

    await saveOperation(
      buildExpense({
        date: '2025-03-05',
        bucketId: (await db.buckets.toArray())[0]!.id,
        description: 'Лишняя трата',
        lines: [
          {
            locationId: (await db.locations.toArray())[0]!.id,
            currency: 'BYN',
            amount: byn(480),
          },
        ],
      }),
    );
    expect(await db.operations.count()).toBe(3);

    await importBackup(parseBackup(text));
    expect(await db.operations.count()).toBe(2);
    expect(
      (await db.operations.toArray()).some((o) => o.description === 'Лишняя трата'),
    ).toBe(false);
  });
});

describe('разбор файла бэкапа', () => {
  it('отвергает чужой или битый файл понятной ошибкой', () => {
    expect(() => parseBackup('не json')).toThrow(BackupFormatError);
    expect(() => parseBackup('{}')).toThrow(/не от MoneyBasket/);
    expect(() => parseBackup(JSON.stringify({ app: 'moneybasket' }))).toThrow(
      /версия формата/,
    );
    expect(() =>
      parseBackup(
        JSON.stringify({ app: 'moneybasket', schemaVersion: 99, data: {} }),
      ),
    ).toThrow(/более новой версией/);
    expect(() =>
      parseBackup(
        JSON.stringify({
          app: 'moneybasket',
          schemaVersion: 1,
          data: { buckets: 'нет' },
        }),
      ),
    ).toThrow(/повреждена/);
  });
});

describe('напоминание о бэкапе', () => {
  const now = Date.parse('2025-03-12T12:00:00.000Z');

  it('просит бэкап, если его не было ни разу', () => {
    expect(backupIsStale(undefined, now)).toBe(true);
  });

  it('молчит первую неделю после бэкапа', () => {
    expect(backupIsStale('2025-03-10T12:00:00.000Z', now)).toBe(false);
  });

  it('напоминает, когда прошло больше недели', () => {
    expect(backupIsStale('2025-03-01T12:00:00.000Z', now)).toBe(true);
  });
});
