import { useMemo } from 'react';
import { Card, cx } from '../../ui/primitives.tsx';
import { formatDate, type Format } from '../../app/format.ts';
import { TYPE_LABELS, isEntryType } from '../entry/state.ts';
import type { Entry, Operation } from '../../domain/types.ts';

/**
 * Общая лента операций: используется и на экране корзины, и на экране всех
 * операций. Разница только в области просмотра — по одной корзине или по всем.
 */
export interface OperationRow {
  operation: Operation;
  /** Проводки, попавшие в область просмотра. */
  entries: Entry[];
  /** Нетто-изменение по валютам; нулевые валюты выброшены. */
  delta: Map<string, number>;
  /**
   * Сколько всего двигалось по каждой валюте. Нужно там, где нетто нулевое:
   * перемещение и перевод между корзинами иначе выглядят как строка без суммы.
   */
  gross: Map<string, number>;
  bucketIds: string[];
}

/**
 * Собирает строки ленты. Чистая функция — вся выборка из базы остаётся снаружи.
 * `bucketId` сужает область до одной корзины: тогда перевод между корзинами
 * показывает движение именно этой корзины, а не ноль.
 */
export function buildRows(
  operations: readonly Operation[],
  entries: readonly Entry[],
  bucketId?: string,
): OperationRow[] {
  const byOperation = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (bucketId !== undefined && entry.bucketId !== bucketId) continue;
    const list = byOperation.get(entry.operationId);
    if (list) list.push(entry);
    else byOperation.set(entry.operationId, [entry]);
  }

  const rows: OperationRow[] = [];
  for (const operation of operations) {
    const own = byOperation.get(operation.id);
    if (!own) continue;

    const delta = new Map<string, number>();
    const gross = new Map<string, number>();
    const buckets = new Set<string>();
    for (const entry of own) {
      delta.set(entry.currency, (delta.get(entry.currency) ?? 0) + entry.amount);
      if (entry.amount > 0) {
        gross.set(entry.currency, (gross.get(entry.currency) ?? 0) + entry.amount);
      }
      buckets.add(entry.bucketId);
    }
    for (const [currency, amount] of delta) if (amount === 0) delta.delete(currency);

    rows.push({ operation, entries: own, delta, gross, bucketIds: [...buckets] });
  }
  return rows;
}

const OTHER_LABELS: Record<string, string> = {
  opening: 'Стартовый остаток',
  reallocate: 'Между корзинами',
  invest_out: 'Вывод',
  adjustment: 'Корректировка',
};

export function describeOperation(row: OperationRow): string {
  const type = row.operation.type;
  const label = isEntryType(type) ? TYPE_LABELS[type] : (OTHER_LABELS[type] ?? type);
  const rate = row.operation.meta?.rate;
  // Курс — не деньги, но показываем его по-русски, как остальные числа.
  return rate === undefined
    ? label
    : `${label} · курс ${String(rate).replace('.', ',')}`;
}

export function DayGroups({
  rows,
  format,
  onOpen,
  bucketNameOf,
}: {
  rows: readonly OperationRow[];
  format: Format;
  onOpen: (id: string) => void;
  /** Если задано, в строке показываются затронутые корзины. */
  bucketNameOf?: ((id: string) => string) | undefined;
}) {
  const days = useMemo(() => {
    const map = new Map<string, OperationRow[]>();
    for (const row of rows) {
      const list = map.get(row.operation.date);
      if (list) list.push(row);
      else map.set(row.operation.date, [row]);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <div className="space-y-4">
      {days.map(([date, dayRows]) => (
        <section key={date}>
          <h2 className="mb-1.5 text-sm text-muted">{formatDate(date)}</h2>
          <div className="space-y-1.5">
            {dayRows.map((row) => (
              <Card
                key={row.operation.id}
                className="flex items-center gap-3 p-3"
                onClick={
                  isEntryType(row.operation.type)
                    ? () => onOpen(row.operation.id)
                    : undefined
                }
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate">
                    {row.operation.description || describeOperation(row)}
                  </p>
                  {subtitle(row, bucketNameOf) !== '' && (
                    <p className="truncate text-xs text-muted">
                      {subtitle(row, bucketNameOf)}
                    </p>
                  )}
                </div>
                <Amounts row={row} format={format} />
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function subtitle(
  row: OperationRow,
  bucketNameOf?: ((id: string) => string) | undefined,
): string {
  const type = describeOperation(row);
  if (!bucketNameOf) {
    // На экране корзины подпись дублировала бы описание, если они совпали.
    return type === row.operation.description ? '' : type;
  }
  // Стрелка уместна только у перевода: там порядок корзин означает направление.
  // У остальных операций несколько корзин — просто перечисление.
  const separator = row.operation.type === 'reallocate' ? ' → ' : ', ';
  const buckets = row.bucketIds.map(bucketNameOf).filter(Boolean).join(separator);
  return buckets === '' ? type : `${type} · ${buckets}`;
}

function Amounts({ row, format }: { row: OperationRow; format: Format }) {
  // Нулевое нетто означает, что деньги только переложили: показываем объём
  // движения, иначе строка выглядит как операция без суммы.
  if (row.delta.size === 0) {
    const moved = [...row.gross.entries()]
      .map(([currency, amount]) => format.money(amount, currency))
      .join(' · ');
    return (
      <div className="tnum shrink-0 text-right text-sm text-muted">
        {moved === '' ? 'перемещение' : moved}
      </div>
    );
  }

  return (
    <div className="tnum shrink-0 text-right">
      {[...row.delta.entries()].map(([currency, amount]) => (
        <p key={currency} className={cx('text-sm', amount > 0 && 'text-ok')}>
          {amount > 0 ? '+' : ''}
          {format.money(amount, currency)}
        </p>
      ))}
    </div>
  );
}
