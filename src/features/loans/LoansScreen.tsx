import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppData } from '../../app/useAppData.ts';
import { db } from '../../db/db.ts';
import { listOperations } from '../../db/repo.ts';
import { formatDate, todayIso } from '../../app/format.ts';
import { Button, Card, EmptyState, ScreenTitle, cx } from '../../ui/primitives.tsx';
import type { Operation } from '../../domain/types.ts';

interface LoanView {
  locationId: string;
  bucketId: string;
  counterparty: string;
  currency: string;
  amount: number;
  /** Когда выдали — по первой операции займа. */
  issuedOn?: string;
  dueDate?: string;
}

export function LoansScreen() {
  const navigate = useNavigate();
  const { ready, holdings, locations, format, bucketOf, locationOf } = useAppData();
  const [showClosed, setShowClosed] = useState(false);
  const today = todayIso();

  const loanOperations = useLiveQuery(async () => {
    const operations = await listOperations();
    const loans = operations.filter(
      (o) => o.type === 'loan_out' || o.type === 'opening',
    );
    const entries = await db.entries
      .where('operationId')
      .anyOf(loans.map((o) => o.id))
      .toArray();
    return { loans, entries };
  }, []);

  const receivables = useMemo(
    () => locations.filter((l) => l.kind === 'receivable'),
    [locations],
  );

  const open: LoanView[] = useMemo(() => {
    const byLocation = new Map<string, Operation>();
    for (const entry of loanOperations?.entries ?? []) {
      const operation = loanOperations?.loans.find((o) => o.id === entry.operationId);
      if (!operation || entry.amount <= 0) continue;
      const current = byLocation.get(`${entry.locationId}:${entry.bucketId}`);
      if (!current || operation.date < current.date) {
        byLocation.set(`${entry.locationId}:${entry.bucketId}`, operation);
      }
    }

    return holdings
      .filter((h) => receivables.some((r) => r.id === h.locationId) && h.amount !== 0)
      .map((h) => {
        const location = locationOf.get(h.locationId);
        const source = byLocation.get(`${h.locationId}:${h.bucketId}`);
        return {
          locationId: h.locationId,
          bucketId: h.bucketId,
          counterparty: location?.counterparty ?? location?.name ?? '—',
          currency: h.currency,
          amount: h.amount,
          ...(source ? { issuedOn: source.date } : {}),
          ...(source?.meta?.dueDate ? { dueDate: source.meta.dueDate } : {}),
        };
      })
      .sort((a, b) => b.amount - a.amount);
  }, [holdings, receivables, locationOf, loanOperations]);

  /** Контрагенты без открытого долга — займы, которые уже закрыли. */
  const closed = useMemo(
    () =>
      receivables.filter(
        (r) => !open.some((loan) => loan.locationId === r.id),
      ),
    [receivables, open],
  );

  if (!ready) return <div className="min-h-dvh bg-bg" aria-busy="true" />;

  return (
    <div className="mx-auto min-h-dvh max-w-md pb-28">
      <ScreenTitle title="Займы" back={() => navigate('/')} />

      <div className="px-4 pt-4">
        {open.length === 0 ? (
          <EmptyState
            title="Открытых займов нет"
            hint="Займ вносится через «+ Операция» → «Дал в долг»."
          />
        ) : (
          <div className="space-y-2">
            {open.map((loan) => {
              const overdue = loan.dueDate !== undefined && loan.dueDate < today;
              return (
                <Card
                  key={`${loan.locationId}-${loan.currency}`}
                  className={cx('p-4', overdue && 'border-danger/50')}
                >
                  <div className="flex items-baseline gap-2">
                    <p className="flex-1 truncate font-medium">{loan.counterparty}</p>
                    <p className="tnum font-semibold">
                      {format.money(loan.amount, loan.currency)}
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    из «{bucketOf.get(loan.bucketId)?.name ?? '—'}»
                    {loan.issuedOn !== undefined && ` · с ${formatDate(loan.issuedOn)}`}
                  </p>
                  {loan.dueDate !== undefined && (
                    <p className={cx('text-sm', overdue ? 'text-danger' : 'text-muted')}>
                      {overdue ? 'Просрочен с ' : 'Вернуть до '}
                      {formatDate(loan.dueDate)}
                    </p>
                  )}
                  <Button
                    className="mt-3 w-full text-sm"
                    onClick={() => navigate('/new')}
                  >
                    Записать возврат
                  </Button>
                </Card>
              );
            })}
          </div>
        )}

        {closed.length > 0 && (
          <div className="mt-6">
            <Button
              variant="ghost"
              className="px-0 text-sm"
              onClick={() => setShowClosed((v) => !v)}
            >
              {showClosed ? '▾' : '▸'} Закрытые ({closed.length})
            </Button>
            {showClosed && (
              <ul className="mt-1 space-y-1">
                {closed.map((r) => (
                  <li key={r.id} className="text-sm text-muted">
                    {r.counterparty ?? r.name} — долгов нет
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
