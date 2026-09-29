import {
  buildExchange,
  buildExpense,
  buildLoanOut,
  buildLoanReturn,
  buildMove,
  buildReallocate,
  buildToPocket,
  buildTopup,
  newId,
  type ReallocateLeg,
} from '../../domain/operations.ts';
import type {
  Entry,
  Location,
  OperationDraft,
  OperationType,
  TopupSource,
} from '../../domain/types.ts';
import type { Format } from '../../app/format.ts';
import { todayIso } from '../../app/format.ts';

/** Типы, доступные в быстром вводе на этапе MVP. */
export const ENTRY_TYPES = [
  'expense',
  'topup',
  'move',
  'exchange',
  'reallocate',
  'loan_out',
  'loan_return',
  'to_pocket',
] as const;

export type EntryType = (typeof ENTRY_TYPES)[number];

export const TYPE_LABELS: Record<EntryType, string> = {
  expense: 'Расход',
  topup: 'Пополнение',
  move: 'Перемещение',
  exchange: 'Обмен',
  reallocate: 'Между корзинами',
  loan_out: 'Дал в долг',
  loan_return: 'Вернули долг',
  to_pocket: 'В карманные',
};

export const SOURCE_LABELS: Record<TopupSource, string> = {
  salary: 'Зарплата',
  advance: 'Аванс',
  vacation_pay: 'Отпускные',
  pocket: 'Из карманных',
  gift: 'Подарок',
  rent_income: 'С квартиры',
  other: 'Другое',
};

export function isEntryType(value: OperationType): value is EntryType {
  return (ENTRY_TYPES as readonly string[]).includes(value);
}

export interface LineState {
  id: string;
  locationId: string;
  currency: string;
  amount: string;
}

export interface FormState {
  type: EntryType;
  bucketId: string;
  date: string;
  description: string;
  source: TopupSource | '';
  /** Для расхода, пополнения и «в карманные» — одна или несколько строк оплаты. */
  lines: LineState[];
  /** Перемещение: откуда. Обмен: что отдали. Займ: реальное место. */
  from: LineState;
  /** Перемещение: куда. Обмен: что получили. */
  to: LineState;
  /** Перевод между корзинами: в какую корзину. */
  toBucketId: string;
  /**
   * Встречное плечо перевода: что уходит обратно в исходную корзину.
   * Пустая сумма означает обычный односторонний перевод.
   */
  counter: LineState;
  /** Место-контрагент, kind: 'receivable'. */
  counterpartyId: string;
  dueDate: string;
  /** Комиссия обмена, в валюте списания. */
  fee: string;
}

export function emptyLine(locationId = '', currency = 'BYN'): LineState {
  return { id: newId(), locationId, currency, amount: '' };
}

export function initialForm(overrides: Partial<FormState> = {}): FormState {
  return {
    type: 'expense',
    bucketId: '',
    date: todayIso(),
    description: '',
    source: '',
    lines: [emptyLine()],
    from: emptyLine(),
    to: emptyLine(),
    toBucketId: '',
    counter: emptyLine(),
    counterpartyId: '',
    dueDate: '',
    fee: '',
    ...overrides,
  };
}

export interface BuildResult {
  draft?: OperationDraft;
  /** Причина, по которой форму пока нельзя сохранить. */
  problem?: string;
}

/**
 * Превращает состояние формы в операцию с проводками.
 * Инварианты здесь не проверяются — это делает validateOperation.
 */
export function buildDraft(
  form: FormState,
  format: Format,
  existing?: { id: string; createdAt: string },
): BuildResult {
  const base = {
    date: form.date,
    description: form.description,
    ...(existing ? { id: existing.id, createdAt: existing.createdAt } : {}),
  };

  if (form.bucketId === '') return { problem: 'Выберите корзину' };

  const parse = (line: LineState) => format.parse(line.amount, line.currency);

  switch (form.type) {
    case 'expense':
    case 'topup':
    case 'to_pocket': {
      const lines = [];
      for (const line of form.lines) {
        if (line.locationId === '') return { problem: 'Выберите место' };
        const amount = parse(line);
        if (amount === null || amount === 0) return { problem: 'Введите сумму' };
        lines.push({
          locationId: line.locationId,
          currency: line.currency,
          amount: Math.abs(amount),
        });
      }
      if (form.type === 'expense') {
        return { draft: buildExpense({ ...base, bucketId: form.bucketId, lines }) };
      }
      if (form.type === 'to_pocket') {
        return { draft: buildToPocket({ ...base, bucketId: form.bucketId, lines }) };
      }
      const first = lines[0]!;
      if (lines.length > 1) {
        return { problem: 'Пополнение вносится по одному месту за раз' };
      }
      return {
        draft: buildTopup({
          ...base,
          bucketId: form.bucketId,
          locationId: first.locationId,
          currency: first.currency,
          amount: first.amount,
          ...(form.source !== '' ? { source: form.source } : {}),
        }),
      };
    }

    case 'move': {
      if (form.from.locationId === '' || form.to.locationId === '') {
        return { problem: 'Выберите откуда и куда' };
      }
      const amount = parse(form.from);
      if (amount === null || amount === 0) return { problem: 'Введите сумму' };
      return {
        draft: buildMove({
          ...base,
          bucketId: form.bucketId,
          currency: form.from.currency,
          amount: Math.abs(amount),
          fromLocationId: form.from.locationId,
          toLocationId: form.to.locationId,
        }),
      };
    }

    case 'exchange': {
      if (form.from.locationId === '' || form.to.locationId === '') {
        return { problem: 'Выберите места' };
      }
      const given = parse(form.from);
      const received = parse(form.to);
      if (given === null || given === 0) return { problem: 'Введите, сколько отдали' };
      if (received === null || received === 0) {
        return { problem: 'Введите, сколько получили' };
      }
      const fee = form.fee === '' ? null : format.parse(form.fee, form.from.currency);
      return {
        draft: buildExchange({
          ...base,
          bucketId: form.bucketId,
          given: {
            locationId: form.from.locationId,
            currency: form.from.currency,
            amount: Math.abs(given),
          },
          received: {
            locationId: form.to.locationId,
            currency: form.to.currency,
            amount: Math.abs(received),
          },
          ...(fee !== null && fee !== 0 ? { fee: Math.abs(fee) } : {}),
          decimals: {
            given: format.decimals(form.from.currency),
            received: format.decimals(form.to.currency),
          },
        }),
      };
    }

    case 'reallocate': {
      if (form.toBucketId === '') return { problem: 'Выберите, в какую корзину' };
      if (form.toBucketId === form.bucketId) {
        return { problem: 'Корзины должны быть разными' };
      }
      if (form.from.locationId === '') return { problem: 'Выберите место' };
      const amount = parse(form.from);
      if (amount === null || amount === 0) return { problem: 'Введите сумму' };

      const legs: ReallocateLeg[] = [
        {
          fromBucketId: form.bucketId,
          toBucketId: form.toBucketId,
          locationId: form.from.locationId,
          currency: form.from.currency,
          amount: Math.abs(amount),
        },
      ];

      // Встречная часть: деньги уходят обратно, обычно в другой валюте.
      if (form.counter.amount !== '') {
        const back = parse(form.counter);
        if (back === null || back === 0) {
          return { problem: 'Введите сумму встречной части' };
        }
        if (form.counter.locationId === '') {
          return { problem: 'Выберите место встречной части' };
        }
        legs.push({
          fromBucketId: form.toBucketId,
          toBucketId: form.bucketId,
          locationId: form.counter.locationId,
          currency: form.counter.currency,
          amount: Math.abs(back),
        });
      }

      return { draft: buildReallocate({ ...base, legs }) };
    }

    case 'loan_out':
    case 'loan_return': {
      if (form.counterpartyId === '') return { problem: 'Выберите, кому одолжили' };
      if (form.from.locationId === '') {
        return {
          problem:
            form.type === 'loan_out' ? 'Выберите, откуда деньги' : 'Выберите, куда пришли',
        };
      }
      const amount = parse(form.from);
      if (amount === null || amount === 0) return { problem: 'Введите сумму' };
      const shared = {
        ...base,
        bucketId: form.bucketId,
        currency: form.from.currency,
        amount: Math.abs(amount),
        counterpartyLocationId: form.counterpartyId,
      };
      if (form.type === 'loan_out') {
        return {
          draft: buildLoanOut({
            ...shared,
            fromLocationId: form.from.locationId,
            ...(form.dueDate !== '' ? { dueDate: form.dueDate } : {}),
          }),
        };
      }
      return {
        draft: buildLoanReturn({ ...shared, toLocationId: form.from.locationId }),
      };
    }
  }
}

/** Восстанавливает форму из сохранённой операции — для редактирования. */
export function formFromDraft(
  draft: OperationDraft,
  locations: readonly Location[],
  format: Format,
): FormState | null {
  const { operation, entries } = draft;
  if (!isEntryType(operation.type)) return null;

  const kindOf = (id: string) => locations.find((l) => l.id === id)?.kind;
  const toLine = (entry: (typeof entries)[number]): LineState => ({
    id: entry.id,
    locationId: entry.locationId,
    currency: entry.currency,
    amount: format.amount(Math.abs(entry.amount), entry.currency).replace(/ /g, ''),
  });

  const bucketId = entries[0]?.bucketId ?? '';
  const form = initialForm({
    type: operation.type,
    bucketId,
    date: operation.date,
    description: operation.description,
    source: operation.source ?? '',
    dueDate: operation.meta?.dueDate ?? '',
  });

  /**
   * Dexie отдаёт проводки в порядке первичного ключа, то есть случайного
   * uuid. Чтобы форма при редактировании не тасовала строки, раскладываем их
   * в том же порядке, в каком идут места хранения на экране.
   */
  const sortOf = (locationId: string) =>
    locations.find((l) => l.id === locationId)?.sort ?? Number.MAX_SAFE_INTEGER;
  const byLocation = (a: Entry, b: Entry) =>
    sortOf(a.locationId) - sortOf(b.locationId) ||
    a.currency.localeCompare(b.currency);

  const negative = entries.filter((e) => e.amount < 0);
  const positive = entries.filter((e) => e.amount > 0);

  switch (operation.type) {
    case 'expense':
    case 'to_pocket':
      form.lines = [...negative].sort(byLocation).map(toLine);
      break;

    case 'topup':
      form.lines = [...positive].sort(byLocation).map(toLine);
      break;

    case 'move':
      if (negative[0]) form.from = toLine(negative[0]);
      if (positive[0]) form.to = toLine(positive[0]);
      break;

    case 'exchange': {
      // Комиссия лежит в той же валюте и том же месте, что и списание,
      // поэтому отличаем её по сумме из meta, а не по позиции в массиве:
      // порядок проводок из базы не гарантирован.
      const feeAmount = operation.meta?.fee;
      const feeEntry =
        feeAmount === undefined
          ? undefined
          : negative.find((e) => Math.abs(e.amount) === feeAmount);
      const given = negative.find((e) => e !== feeEntry) ?? negative[0];

      if (given) form.from = toLine(given);
      if (positive[0]) form.to = toLine(positive[0]);
      if (feeEntry) {
        form.fee = format
          .amount(Math.abs(feeEntry.amount), feeEntry.currency)
          .replace(/ /g, '');
      }
      break;
    }

    case 'reallocate': {
      // Проводки идут парами «ушло / пришло», по паре на плечо.
      const [out, , counterOut] = entries;
      if (out) {
        form.bucketId = out.bucketId;
        form.from = toLine(out);
      }
      const incoming = entries.find((e) => e.amount > 0);
      if (incoming) form.toBucketId = incoming.bucketId;
      if (counterOut && counterOut.amount < 0) form.counter = toLine(counterOut);
      break;
    }

    case 'loan_out':
    case 'loan_return': {
      const receivable = entries.find((e) => kindOf(e.locationId) === 'receivable');
      const real = entries.find((e) => kindOf(e.locationId) !== 'receivable');
      if (receivable) form.counterpartyId = receivable.locationId;
      if (real) form.from = toLine(real);
      break;
    }
  }

  return form;
}

// ─── память последнего выбора ───────────────────────────────────────────────

interface LastUsed {
  bucketId?: string;
  locationId?: string;
}

const KEY = 'moneybasket:last-used';

export function readLastUsed(type: EntryType): LastUsed {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, LastUsed>;
    return parsed[type] ?? {};
  } catch {
    return {};
  }
}

export function writeLastUsed(type: EntryType, value: LastUsed): void {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, LastUsed>) : {};
    parsed[type] = { ...parsed[type], ...value };
    localStorage.setItem(KEY, JSON.stringify(parsed));
  } catch {
    // Приватный режим или переполнение — не повод ронять сохранение операции.
  }
}
