import { toMajor } from './money.ts';
import type {
  CurrencyCode,
  Entry,
  Operation,
  OperationDraft,
  OperationMeta,
  OperationType,
  TopupSource,
} from './types.ts';

export function newId(): string {
  return crypto.randomUUID();
}

/** Одна строка операции: место, валюта, сумма в минорных единицах (без знака). */
export interface Line {
  locationId: string;
  currency: CurrencyCode;
  amount: number;
}

interface BaseInput {
  date: string;
  description?: string;
  tag?: string;
  /** Для редактирования: сохранить существующий id и createdAt. */
  id?: string;
  createdAt?: string;
  now?: string;
}

/** Убирает ключи со значением undefined: в базе их держать незачем. */
function compact<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

function makeOperation(
  type: OperationType,
  input: BaseInput,
  extra: { source?: TopupSource; meta?: OperationMeta } = {},
): Operation {
  const now = input.now ?? new Date().toISOString();
  const meta = extra.meta ? compact(extra.meta) : undefined;
  return {
    id: input.id ?? newId(),
    type,
    date: input.date,
    description: input.description?.trim() ?? '',
    ...(input.tag !== undefined ? { tag: input.tag } : {}),
    ...(extra.source !== undefined ? { source: extra.source } : {}),
    ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

function makeEntry(
  operationId: string,
  bucketId: string,
  line: Line,
  sign: 1 | -1,
): Entry {
  return {
    id: newId(),
    operationId,
    bucketId,
    locationId: line.locationId,
    currency: line.currency,
    amount: sign * Math.abs(line.amount),
  };
}

// ─── opening ────────────────────────────────────────────────────────────────

export interface OpeningLine extends Line {
  bucketId: string;
}

/** Стартовые остатки: одна операция на всю таблицу онбординга. */
export function buildOpening(
  input: BaseInput & { lines: readonly OpeningLine[] },
): OperationDraft {
  const operation = makeOperation('opening', {
    ...input,
    description: input.description ?? 'Стартовый остаток',
  });
  const entries = input.lines.map((l) => makeEntry(operation.id, l.bucketId, l, 1));
  return { operation, entries };
}

// ─── topup ──────────────────────────────────────────────────────────────────

export function buildTopup(
  input: BaseInput & { bucketId: string; source?: TopupSource } & Line,
): OperationDraft {
  const operation = makeOperation(
    'topup',
    input,
    input.source ? { source: input.source } : {},
  );
  return {
    operation,
    entries: [makeEntry(operation.id, input.bucketId, input, 1)],
  };
}

// ─── expense / to_pocket / invest_out ───────────────────────────────────────

/** Расход, возможно разбитый по нескольким местам оплаты. */
export function buildExpense(
  input: BaseInput & { bucketId: string; lines: readonly Line[] },
): OperationDraft {
  return buildOutflow('expense', input);
}

/** Безвозвратно отдал в карманные. */
export function buildToPocket(
  input: BaseInput & { bucketId: string; lines: readonly Line[] },
): OperationDraft {
  return buildOutflow('to_pocket', input);
}

/** Вывод в крипту или на кошелёк — деньги уходят из учёта. */
export function buildInvestOut(
  input: BaseInput & {
    bucketId: string;
    lines: readonly Line[];
    receivedAsset?: string;
  },
): OperationDraft {
  return buildOutflow('invest_out', input, {
    meta: input.receivedAsset ? { receivedAsset: input.receivedAsset } : undefined,
  });
}

function buildOutflow(
  type: 'expense' | 'to_pocket' | 'invest_out',
  input: BaseInput & { bucketId: string; lines: readonly Line[] },
  extra: { meta?: OperationMeta | undefined } = {},
): OperationDraft {
  const operation = makeOperation(
    type,
    input,
    extra.meta ? { meta: extra.meta } : {},
  );
  const entries = input.lines.map((l) => makeEntry(operation.id, input.bucketId, l, -1));
  return { operation, entries };
}

// ─── move ───────────────────────────────────────────────────────────────────

export function buildMove(
  input: BaseInput & {
    bucketId: string;
    currency: CurrencyCode;
    amount: number;
    fromLocationId: string;
    toLocationId: string;
  },
): OperationDraft {
  const operation = makeOperation('move', input);
  const { currency, amount, bucketId } = input;
  return {
    operation,
    entries: [
      makeEntry(operation.id, bucketId, { locationId: input.fromLocationId, currency, amount }, -1),
      makeEntry(operation.id, bucketId, { locationId: input.toLocationId, currency, amount }, 1),
    ],
  };
}

// ─── exchange ───────────────────────────────────────────────────────────────

/**
 * Обмен валют внутри корзины.
 * `meta.rate` — сколько отдано за одну единицу полученной валюты; хранится
 * только для показа, в расчёте остатков не участвует.
 */
export function buildExchange(
  input: BaseInput & {
    bucketId: string;
    given: Line;
    received: Line;
    /** Комиссия в валюте списания, в минорных единицах. */
    fee?: number;
    /** Знаки после запятой у отданной и полученной валюты — для расчёта курса. */
    decimals?: { given: number; received: number };
  },
): OperationDraft {
  const { given, received, fee, bucketId } = input;
  const d = input.decimals ?? { given: 2, received: 2 };
  const rate = computeRate(given.amount, received.amount, d.given, d.received);

  const meta: OperationMeta = { rate };
  if (fee !== undefined && fee !== 0) meta.fee = Math.abs(fee);

  const operation = makeOperation('exchange', input, { meta });
  const entries = [
    makeEntry(operation.id, bucketId, given, -1),
    makeEntry(operation.id, bucketId, received, 1),
  ];
  if (fee !== undefined && fee !== 0) {
    entries.push(
      makeEntry(
        operation.id,
        bucketId,
        { locationId: given.locationId, currency: given.currency, amount: fee },
        -1,
      ),
    );
  }
  return { operation, entries };
}

/** Курс: сколько отдано за 1 единицу полученного. Округление до 4 знаков. */
export function computeRate(
  givenMinor: number,
  receivedMinor: number,
  givenDecimals: number,
  receivedDecimals: number,
): number {
  if (receivedMinor === 0) return 0;
  const given = toMajor(Math.abs(givenMinor), givenDecimals);
  const received = toMajor(Math.abs(receivedMinor), receivedDecimals);
  return Math.round((given / received) * 10_000) / 10_000;
}

// ─── loans ──────────────────────────────────────────────────────────────────

export function buildLoanOut(
  input: BaseInput & {
    bucketId: string;
    currency: CurrencyCode;
    amount: number;
    /** Откуда реально ушли деньги. */
    fromLocationId: string;
    /** Место-контрагент, kind: 'receivable'. */
    counterpartyLocationId: string;
    dueDate?: string;
  },
): OperationDraft {
  const operation = makeOperation(
    'loan_out',
    input,
    input.dueDate ? { meta: { dueDate: input.dueDate } } : {},
  );
  const { currency, amount, bucketId } = input;
  return {
    operation,
    entries: [
      makeEntry(operation.id, bucketId, { locationId: input.fromLocationId, currency, amount }, -1),
      makeEntry(operation.id, bucketId, { locationId: input.counterpartyLocationId, currency, amount }, 1),
    ],
  };
}

export function buildLoanReturn(
  input: BaseInput & {
    bucketId: string;
    currency: CurrencyCode;
    amount: number;
    /** Куда пришли деньги. */
    toLocationId: string;
    counterpartyLocationId: string;
  },
): OperationDraft {
  const operation = makeOperation('loan_return', input);
  const { currency, amount, bucketId } = input;
  return {
    operation,
    entries: [
      makeEntry(operation.id, bucketId, { locationId: input.counterpartyLocationId, currency, amount }, -1),
      makeEntry(operation.id, bucketId, { locationId: input.toLocationId, currency, amount }, 1),
    ],
  };
}

// ─── reallocate ─────────────────────────────────────────────────────────────

/** Одно «плечо» перевода: сумма уходит из одной корзины и приходит в другую. */
export interface ReallocateLeg {
  fromBucketId: string;
  toBucketId: string;
  locationId: string;
  currency: CurrencyCode;
  amount: number;
  /** Если место назначения отличается от места списания. */
  toLocationId?: string;
}

/**
 * Перевод между корзинами. Встречный обмен — это просто два плеча
 * в противоположных направлениях, в разных валютах.
 */
export function buildReallocate(
  input: BaseInput & { legs: readonly ReallocateLeg[] },
): OperationDraft {
  const operation = makeOperation('reallocate', input);
  const entries: Entry[] = [];
  for (const leg of input.legs) {
    const line = { locationId: leg.locationId, currency: leg.currency, amount: leg.amount };
    entries.push(makeEntry(operation.id, leg.fromBucketId, line, -1));
    entries.push(
      makeEntry(
        operation.id,
        leg.toBucketId,
        { ...line, locationId: leg.toLocationId ?? leg.locationId },
        1,
      ),
    );
  }
  return { operation, entries };
}

// ─── adjustment ─────────────────────────────────────────────────────────────

/** Корректировка по итогам сверки. `delta` со знаком. */
export function buildAdjustment(
  input: BaseInput & {
    bucketId: string;
    locationId: string;
    currency: CurrencyCode;
    delta: number;
  },
): OperationDraft {
  const operation = makeOperation('adjustment', input);
  const line = {
    locationId: input.locationId,
    currency: input.currency,
    amount: Math.abs(input.delta),
  };
  return {
    operation,
    entries: [makeEntry(operation.id, input.bucketId, line, input.delta < 0 ? -1 : 1)],
  };
}
