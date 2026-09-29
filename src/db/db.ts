import Dexie, { type EntityTable } from 'dexie';
import type {
  AllocationTemplate,
  Bucket,
  Currency,
  Entry,
  IncomeRecord,
  Location,
  Operation,
  Rate,
  Settings,
} from '../domain/types.ts';

/** Версия формата экспорта. Растёт вместе со схемой базы. */
export const SCHEMA_VERSION = 1;

export class MoneyBasketDb extends Dexie {
  buckets!: EntityTable<Bucket, 'id'>;
  locations!: EntityTable<Location, 'id'>;
  currencies!: EntityTable<Currency, 'code'>;
  operations!: EntityTable<Operation, 'id'>;
  entries!: EntityTable<Entry, 'id'>;
  incomes!: EntityTable<IncomeRecord, 'id'>;
  rates!: EntityTable<Rate, 'date'>;
  templates!: EntityTable<AllocationTemplate, 'id'>;
  settings!: EntityTable<Settings, 'id'>;

  constructor(name = 'moneybasket') {
    super(name);
    this.version(1).stores({
      buckets: 'id, sort, archived',
      locations: 'id, sort, archived, kind',
      currencies: 'code, sort',
      operations: 'id, date, type, deletedAt, createdAt',
      entries: 'id, operationId, bucketId, locationId, [bucketId+locationId+currency]',
      incomes: 'id, date, month, kind',
      rates: '[date+currency], currency, date',
      templates: 'id',
      settings: 'id',
    });
  }
}

export const db = new MoneyBasketDb();

/** Все таблицы в порядке, пригодном для экспорта и полной очистки. */
export const TABLE_NAMES = [
  'buckets',
  'locations',
  'currencies',
  'operations',
  'entries',
  'incomes',
  'rates',
  'templates',
  'settings',
] as const;

export type TableName = (typeof TABLE_NAMES)[number];
