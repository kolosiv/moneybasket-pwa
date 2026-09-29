import { SCHEMA_VERSION, TABLE_NAMES, db, type TableName } from './db.ts';
import { patchSettings } from './repo.ts';

export interface BackupFile {
  app: 'moneybasket';
  schemaVersion: number;
  exportedAt: string;
  data: Record<TableName, unknown[]>;
}

export async function exportBackup(): Promise<BackupFile> {
  const data = {} as Record<TableName, unknown[]>;
  await db.transaction('r', db.tables, async () => {
    for (const name of TABLE_NAMES) {
      data[name] = await db.table(name).toArray();
    }
  });
  return {
    app: 'moneybasket',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export function backupFileName(date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  return `moneybasket-${stamp}.json`;
}

export class BackupFormatError extends Error {}

/** Разбирает и проверяет файл бэкапа, ничего не записывая. */
export function parseBackup(text: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupFormatError('Это не JSON-файл.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new BackupFormatError('Файл пустой или неправильного формата.');
  }
  const file = parsed as Partial<BackupFile>;
  if (file.app !== 'moneybasket') {
    throw new BackupFormatError('Это бэкап не от MoneyBasket.');
  }
  if (typeof file.schemaVersion !== 'number') {
    throw new BackupFormatError('В файле не указана версия формата.');
  }
  if (file.schemaVersion > SCHEMA_VERSION) {
    throw new BackupFormatError(
      `Файл сделан более новой версией приложения (формат ${file.schemaVersion}, здесь ${SCHEMA_VERSION}). Обновите приложение.`,
    );
  }
  if (typeof file.data !== 'object' || file.data === null) {
    throw new BackupFormatError('В файле нет данных.');
  }
  for (const name of TABLE_NAMES) {
    const rows = (file.data as Record<string, unknown>)[name];
    if (rows !== undefined && !Array.isArray(rows)) {
      throw new BackupFormatError(`Таблица «${name}» повреждена.`);
    }
  }
  return file as BackupFile;
}

/** Полностью заменяет данные содержимым бэкапа. Вызывать только после подтверждения. */
export async function importBackup(file: BackupFile): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const name of TABLE_NAMES) {
      await db.table(name).clear();
      const rows = file.data[name];
      if (rows && rows.length > 0) await db.table(name).bulkPut(rows);
    }
  });
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const name of TABLE_NAMES) await db.table(name).clear();
  });
}

/** Отмечает, что бэкап сделан — от этой даты считается баннер напоминания. */
export async function markBackedUp(): Promise<void> {
  await patchSettings({ lastBackupAt: new Date().toISOString() });
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function backupIsStale(lastBackupAt: string | undefined, now = Date.now()): boolean {
  if (lastBackupAt === undefined) return true;
  const last = Date.parse(lastBackupAt);
  if (Number.isNaN(last)) return true;
  return now - last > WEEK_MS;
}
