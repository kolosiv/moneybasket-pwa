/** Доменные типы. Без React и без Dexie — только данные. */

export type CurrencyCode = string; // 'BYN' | 'USD' | 'EUR' | 'USDT' | …

export interface Currency {
  code: CurrencyCode;
  symbol: string;
  decimals: number;
  /** USDT считаем равным USD при конвертации. */
  usdPeg?: boolean;
  sort: number;
}

export interface Bucket {
  id: string;
  name: string;
  emoji?: string;
  color?: string;
  /** Только у системной корзины «Нераспределено». */
  system?: 'unallocated';
  target?: { amount: number; currency: CurrencyCode };
  archived: boolean;
  sort: number;
}

export type LocationKind = 'bank' | 'cash' | 'exchange' | 'receivable';

export interface Location {
  id: string;
  name: string;
  kind: LocationKind;
  /** Для kind === 'receivable': кому одолжили. */
  counterparty?: string;
  archived: boolean;
  sort: number;
}

export type OperationType =
  | 'opening'
  | 'topup'
  | 'expense'
  | 'move'
  | 'exchange'
  | 'reallocate'
  | 'loan_out'
  | 'loan_return'
  | 'to_pocket'
  | 'invest_out'
  | 'adjustment';

export type TopupSource =
  | 'salary'
  | 'advance'
  | 'vacation_pay'
  | 'pocket'
  | 'gift'
  | 'rent_income'
  | 'other';

export interface OperationMeta {
  /** Для exchange: сколько отдано за 1 единицу полученной валюты. */
  rate?: number;
  /** Комиссия в валюте списания, в минорных единицах. */
  fee?: number;
  /** Для loan_out: срок возврата, YYYY-MM-DD. */
  dueDate?: string;
  /** Для invest_out: «0.0012 BTC», «180 USDT на кошелёк». */
  receivedAsset?: string;
}

export interface Operation {
  id: string;
  type: OperationType;
  /** YYYY-MM-DD, без времени. */
  date: string;
  description: string;
  tag?: string;
  source?: TopupSource;
  meta?: OperationMeta;
  createdAt: string;
  updatedAt: string;
  /** Мягкое удаление. */
  deletedAt?: string;
}

export interface Entry {
  id: string;
  operationId: string;
  bucketId: string;
  locationId: string;
  currency: CurrencyCode;
  /** Целое, в минорных единицах, со знаком. */
  amount: number;
}

/** Операция вместе со своими проводками — то, что домен строит и валидирует. */
export interface OperationDraft {
  operation: Operation;
  entries: Entry[];
}

export interface IncomeRecord {
  id: string;
  date: string;
  /** YYYY-MM — к какому месяцу относится (отпускные могут переезжать). */
  month: string;
  kind: 'advance' | 'salary' | 'vacation_pay' | 'rent_income' | 'other';
  amount: number;
  currency: CurrencyCode;
  note?: string;
}

export interface Rate {
  /** YYYY-MM-DD */
  date: string;
  currency: CurrencyCode;
  /** Сколько BYN за одну единицу валюты. Хранится как число, не деньги. */
  bynPerUnit: number;
  source: 'nbrb' | 'manual';
}

export interface AllocationTemplate {
  id: string;
  name: string;
  lines: {
    bucketId: string;
    locationId: string;
    mode: 'fixed' | 'percent';
    value: number;
  }[];
}

export interface Settings {
  id: 'settings';
  baseCurrency: CurrencyCode;
  secondaryCurrency: CurrencyCode;
  lastBackupAt?: string;
  hideAmounts: boolean;
  onboardedAt?: string;
}

/** Остаток по тройке корзина × место × валюта. Не хранится, а вычисляется. */
export interface Holding {
  bucketId: string;
  locationId: string;
  currency: CurrencyCode;
  amount: number;
}
