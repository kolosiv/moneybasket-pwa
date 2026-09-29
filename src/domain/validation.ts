import { formatAmount } from './money.ts';
import { computeHoldings, holdingAmount } from './holdings.ts';
import type {
  Currency,
  CurrencyCode,
  Entry,
  Holding,
  Location,
  OperationDraft,
} from './types.ts';
import { decimalsOf } from './currencies.ts';

export type IssueLevel = 'error' | 'warning';

export interface ValidationIssue {
  level: IssueLevel;
  code: string;
  message: string;
}

export interface ValidationContext {
  locations?: readonly Location[];
  currencies?: readonly Currency[];
  /** Остатки ДО применения операции — для предупреждения об уходе в минус. */
  holdings?: readonly Holding[];
}

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}

function err(code: string, message: string): ValidationIssue {
  return { level: 'error', code, message };
}

function warn(code: string, message: string): ValidationIssue {
  return { level: 'warning', code, message };
}

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function sumsByCurrency(entries: readonly Entry[]): Map<CurrencyCode, number> {
  const out = new Map<CurrencyCode, number>();
  for (const e of entries) out.set(e.currency, (out.get(e.currency) ?? 0) + e.amount);
  return out;
}

/** Требует, чтобы по каждой валюте сумма проводок была нулевой. */
function requireZeroSum(entries: readonly Entry[], label: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [currency, sum] of sumsByCurrency(entries)) {
    if (sum !== 0) {
      issues.push(
        err(
          'nonzero-sum',
          `${label}: сумма проводок по ${currency} должна быть нулевой, а вышло ${sum > 0 ? '+' : ''}${sum}.`,
        ),
      );
    }
  }
  return issues;
}

function requireSingleBucket(
  entries: readonly Entry[],
  label: string,
): ValidationIssue[] {
  const buckets = distinct(entries.map((e) => e.bucketId));
  return buckets.length > 1
    ? [err('multi-bucket', `${label}: все проводки должны быть в одной корзине.`)]
    : [];
}

function requireAllNegative(
  entries: readonly Entry[],
  label: string,
): ValidationIssue[] {
  return entries.some((e) => e.amount > 0)
    ? [err('sign', `${label}: все суммы должны быть расходом, со знаком минус.`)]
    : [];
}

function requireAllPositive(
  entries: readonly Entry[],
  label: string,
): ValidationIssue[] {
  return entries.some((e) => e.amount < 0)
    ? [err('sign', `${label}: все суммы должны быть приходом, со знаком плюс.`)]
    : [];
}

/** Инварианты раздела 4.3 ТЗ. Ошибки блокируют сохранение, предупреждения — нет. */
export function validateOperation(
  draft: OperationDraft,
  ctx: ValidationContext = {},
): ValidationIssue[] {
  const { operation, entries } = draft;
  const issues: ValidationIssue[] = [];

  if (entries.length === 0) {
    return [err('no-entries', 'В операции нет ни одной проводки.')];
  }
  if (entries.some((e) => !Number.isSafeInteger(e.amount))) {
    issues.push(
      err('not-integer', 'Суммы должны быть целыми числами в минорных единицах.'),
    );
  }
  if (entries.some((e) => e.amount === 0)) {
    issues.push(err('zero-amount', 'Нулевые проводки не имеют смысла.'));
  }
  if (entries.some((e) => e.operationId !== operation.id)) {
    issues.push(err('orphan-entry', 'Проводка принадлежит другой операции.'));
  }

  const currencies = distinct(entries.map((e) => e.currency));

  switch (operation.type) {
    case 'opening':
      break;

    case 'topup':
      issues.push(...requireAllPositive(entries, 'Пополнение'));
      break;

    case 'expense':
      issues.push(...requireSingleBucket(entries, 'Расход'));
      issues.push(...requireAllNegative(entries, 'Расход'));
      break;

    case 'to_pocket':
      issues.push(...requireSingleBucket(entries, 'В карманные'));
      issues.push(...requireAllNegative(entries, 'В карманные'));
      break;

    case 'invest_out':
      issues.push(...requireSingleBucket(entries, 'Вывод'));
      issues.push(...requireAllNegative(entries, 'Вывод'));
      break;

    case 'move': {
      issues.push(...requireSingleBucket(entries, 'Перемещение'));
      if (currencies.length !== 1) {
        issues.push(
          err(
            'move-currency',
            'Перемещение возможно только внутри одной валюты. Для смены валюты выберите «Обмен».',
          ),
        );
      }
      issues.push(...requireZeroSum(entries, 'Перемещение'));
      const locations = distinct(entries.map((e) => e.locationId));
      if (locations.length < 2) {
        issues.push(
          err('move-same-location', 'Перемещение должно менять место хранения.'),
        );
      }
      break;
    }

    case 'loan_out':
    case 'loan_return': {
      const label = operation.type === 'loan_out' ? 'Выдача займа' : 'Возврат займа';
      issues.push(...requireSingleBucket(entries, label));
      if (currencies.length !== 1) {
        issues.push(err('loan-currency', `${label}: только одна валюта.`));
      }
      issues.push(...requireZeroSum(entries, label));
      issues.push(...validateLoanSides(operation.type, entries, label, ctx));
      break;
    }

    case 'exchange': {
      issues.push(...requireSingleBucket(entries, 'Обмен'));
      if (currencies.length !== 2) {
        issues.push(
          err(
            'exchange-currency',
            'В обмене должно участвовать ровно две валюты: что отдали и что получили.',
          ),
        );
      } else {
        const sums = sumsByCurrency(entries);
        for (const [currency, sum] of sums) {
          if (sum === 0) {
            issues.push(
              err(
                'exchange-currency',
                `Обмен: по ${currency} ничего не изменилось — это не обмен.`,
              ),
            );
          }
        }
        const signs = distinct([...sums.values()].map((s) => Math.sign(s)));
        if (signs.length === 1) {
          issues.push(
            err(
              'exchange-direction',
              'Обмен: одну валюту нужно отдать, другую получить.',
            ),
          );
        }
      }
      break;
    }

    case 'reallocate': {
      const buckets = distinct(entries.map((e) => e.bucketId));
      if (buckets.length < 2) {
        issues.push(
          err(
            'reallocate-bucket',
            'Перевод между корзинами должен затрагивать минимум две корзины.',
          ),
        );
      }
      issues.push(...requireZeroSum(entries, 'Перевод между корзинами'));
      break;
    }

    case 'adjustment':
      if (operation.description.trim() === '') {
        issues.push(
          err('no-description', 'У корректировки обязательно должно быть описание.'),
        );
      }
      break;
  }

  issues.push(...checkNegativeHoldings(draft, ctx));
  return issues;
}

/** У займа одна сторона — реальное место, другая — контрагент (receivable). */
function validateLoanSides(
  type: 'loan_out' | 'loan_return',
  entries: readonly Entry[],
  label: string,
  ctx: ValidationContext,
): ValidationIssue[] {
  const { locations } = ctx;
  if (!locations) return [];

  const kindOf = (id: string) => locations.find((l) => l.id === id)?.kind;
  const receivableSide = type === 'loan_out' ? 1 : -1;

  const receivables = entries.filter((e) => kindOf(e.locationId) === 'receivable');
  if (receivables.length === 0) {
    return [err('loan-no-counterparty', `${label}: не выбран контрагент займа.`)];
  }
  const wrongDirection = receivables.some(
    (e) => Math.sign(e.amount) !== receivableSide,
  );
  if (wrongDirection) {
    return [
      err(
        'loan-direction',
        type === 'loan_out'
          ? 'Выдача займа должна увеличивать долг контрагента.'
          : 'Возврат займа должен уменьшать долг контрагента.',
      ),
    ];
  }
  return [];
}

/** Уход позиции в минус не блокирует сохранение — только предупреждает. */
function checkNegativeHoldings(
  draft: OperationDraft,
  ctx: ValidationContext,
): ValidationIssue[] {
  const { holdings, locations, currencies } = ctx;
  if (!holdings) return [];

  const after = computeHoldings([
    ...holdings.map(
      (h): Entry => ({
        id: `snapshot-${h.bucketId}-${h.locationId}-${h.currency}`,
        operationId: 'snapshot',
        bucketId: h.bucketId,
        locationId: h.locationId,
        currency: h.currency,
        amount: h.amount,
      }),
    ),
    ...draft.entries,
  ]);

  const issues: ValidationIssue[] = [];
  for (const entry of draft.entries) {
    const amount = holdingAmount(
      after,
      entry.bucketId,
      entry.locationId,
      entry.currency,
    );
    if (amount >= 0) continue;
    const name =
      locations?.find((l) => l.id === entry.locationId)?.name ?? entry.locationId;
    const decimals = currencies ? decimalsOf(currencies, entry.currency) : 2;
    issues.push(
      warn(
        'negative-holding',
        `После операции «${name}» уйдёт в минус: ${formatAmount(amount, decimals)} ${entry.currency}.`,
      ),
    );
  }
  return distinctIssues(issues);
}

function distinctIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  const out: ValidationIssue[] = [];
  for (const i of issues) {
    const key = `${i.code}|${i.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}
