import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { sortHoldings, useAppData } from '../../app/useAppData.ts';
import { db } from '../../db/db.ts';
import { listOperations } from '../../db/repo.ts';
import { formatMonth, monthOf } from '../../app/format.ts';
import { Button, Card, EmptyState, ScreenTitle, cx } from '../../ui/primitives.tsx';
import {
  DayGroups,
  buildRows,
  type OperationRow,
} from '../operations/OperationList.tsx';

export function BucketScreen() {
  const navigate = useNavigate();
  const { bucketId = '' } = useParams();
  const { ready, settings, format, locationOf, bucketOf, holdingsByBucket, convert } =
    useAppData();

  const bucket = bucketOf.get(bucketId);
  const holdings = useMemo(
    () => sortHoldings(holdingsByBucket.get(bucketId) ?? [], locationOf),
    [holdingsByBucket, bucketId, locationOf],
  );

  const rows = useLiveQuery(async (): Promise<OperationRow[]> => {
    const [operations, entries] = await Promise.all([
      listOperations(),
      db.entries.where('bucketId').equals(bucketId).toArray(),
    ]);
    return buildRows(operations, entries, bucketId);
  }, [bucketId]);

  const months = useMemo(() => {
    const set = new Set((rows ?? []).map((r) => monthOf(r.operation.date)));
    return [...set].sort().reverse();
  }, [rows]);

  const [month, setMonth] = useState<string | 'all'>('all');
  const visible = (rows ?? []).filter(
    (r) => month === 'all' || monthOf(r.operation.date) === month,
  );

  const base = convert(holdings, settings.baseCurrency);
  const secondary = convert(holdings, settings.secondaryCurrency);

  if (!ready) return <div className="min-h-dvh bg-bg" aria-busy="true" />;
  if (!bucket) {
    return (
      <div className="mx-auto max-w-md">
        <ScreenTitle title="Корзина" back={() => navigate('/')} />
        <EmptyState title="Корзина не найдена" />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md pb-28">
      <ScreenTitle
        title={`${bucket.emoji ?? ''} ${bucket.name}`.trim()}
        back={() => navigate('/')}
      />

      <section className="px-4 pt-4">
        <p className="tnum text-3xl font-semibold">
          {base === null ? '—' : format.money(base, settings.baseCurrency)}
        </p>
        {secondary !== null && (
          <p className="tnum text-sm text-muted">
            ≈ {format.money(secondary, settings.secondaryCurrency)}
          </p>
        )}

        <Card className="mt-4 p-4">
          <p className="mb-2 text-sm text-muted">Где лежит</p>
          {holdings.length === 0 ? (
            <p className="text-sm text-muted">Пусто</p>
          ) : (
            <ul className="space-y-1">
              {holdings.map((h) => (
                <li
                  key={`${h.locationId}-${h.currency}`}
                  className={cx('flex gap-2 text-sm', h.amount < 0 && 'text-danger')}
                >
                  <span className="tnum">{format.money(h.amount, h.currency)}</span>
                  <span className="truncate text-muted">
                    · {locationOf.get(h.locationId)?.name ?? '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {months.length > 0 && (
        <div className="-mx-0 mt-5 flex gap-2 overflow-x-auto px-4 pb-1">
          <Button
            className={cx('shrink-0 text-sm', month === 'all' && 'bg-accent-soft')}
            onClick={() => setMonth('all')}
          >
            Все
          </Button>
          {months.map((m) => (
            <Button
              key={m}
              className={cx('shrink-0 text-sm', month === m && 'bg-accent-soft')}
              onClick={() => setMonth(m)}
            >
              {formatMonth(m)}
            </Button>
          ))}
        </div>
      )}

      {month !== 'all' && <MonthSummary rows={visible} format={format} />}

      <div className="mt-4 px-4">
        {visible.length === 0 ? (
          <EmptyState
            title="Операций нет"
            hint="Нажмите «+ Операция» на главной."
          />
        ) : (
          <DayGroups rows={visible} format={format} onOpen={(id) => navigate(`/op/${id}`)} />
        )}
      </div>
    </div>
  );
}

/** «Было на начало → пополнения → расходы → стало» за выбранный месяц. */
function MonthSummary({
  rows,
  format,
}: {
  rows: OperationRow[];
  format: ReturnType<typeof useAppData>['format'];
}) {
  const summary = useMemo(() => {
    const income = new Map<string, number>();
    const outcome = new Map<string, number>();
    for (const row of rows) {
      for (const entry of row.entries) {
        const target = entry.amount > 0 ? income : outcome;
        target.set(entry.currency, (target.get(entry.currency) ?? 0) + entry.amount);
      }
    }
    return { income, outcome };
  }, [rows]);

  const line = (map: Map<string, number>) =>
    [...map.entries()]
      .filter(([, amount]) => amount !== 0)
      .map(([currency, amount]) => format.money(Math.abs(amount), currency))
      .join(' · ');

  const incomeText = line(summary.income);
  const outcomeText = line(summary.outcome);
  if (incomeText === '' && outcomeText === '') return null;

  return (
    <Card className="mx-4 mt-3 p-3">
      {incomeText !== '' && (
        <p className="tnum text-sm">
          <span className="text-muted">Пришло: </span>
          <span className="text-ok">{incomeText}</span>
        </p>
      )}
      {outcomeText !== '' && (
        <p className="tnum text-sm">
          <span className="text-muted">Ушло: </span>
          <span>{outcomeText}</span>
        </p>
      )}
      <p className="mt-1 text-xs text-muted">
        Внутренние перемещения попадают в обе строки — это движение, а не траты.
      </p>
    </Card>
  );
}
