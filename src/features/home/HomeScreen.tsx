import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { sortHoldings, useAppData } from '../../app/useAppData.ts';
import { backupIsStale } from '../../db/backup.ts';
import { patchSettings } from '../../db/repo.ts';
import { db } from '../../db/db.ts';
import { Button, Card, EmptyState, cx } from '../../ui/primitives.tsx';
import type { Holding } from '../../domain/types.ts';

const HIDDEN = '••••';

export function HomeScreen() {
  const navigate = useNavigate();
  const {
    ready,
    buckets,
    holdings,
    settings,
    format,
    locationOf,
    holdingsByBucket,
    convert,
  } = useAppData();

  const openLoanBuckets = useLiveQuery(async () => {
    const receivables = new Set(
      (await db.locations.toArray())
        .filter((l) => l.kind === 'receivable')
        .map((l) => l.id),
    );
    return receivables;
  }, []);

  const hidden = settings.hideAmounts;
  const totalBase = convert(holdings, settings.baseCurrency);
  const totalSecondary = convert(holdings, settings.secondaryCurrency);

  const show = (render: () => string) => (hidden ? HIDDEN : render());

  return (
    <div className="mx-auto min-h-dvh max-w-md pb-28">
      <header className="safe-top flex items-center gap-1 px-4 pb-2">
        <h1 className="flex-1 text-lg font-semibold">Корзины</h1>
        <Button
          variant="ghost"
          className="px-2"
          aria-label={hidden ? 'Показать суммы' : 'Скрыть суммы'}
          onClick={() => void patchSettings({ hideAmounts: !hidden })}
        >
          {hidden ? '🙈' : '👁'}
        </Button>
        <Button
          variant="ghost"
          className="px-2"
          aria-label="Операции"
          onClick={() => navigate('/operations')}
        >
          🕘
        </Button>
        <Button
          variant="ghost"
          className="px-2"
          aria-label="Займы"
          onClick={() => navigate('/loans')}
        >
          🤝
        </Button>
        <Button
          variant="ghost"
          className="px-2"
          aria-label="Настройки"
          onClick={() => navigate('/settings')}
        >
          ⚙️
        </Button>
      </header>

      <section className="px-4 pt-2 pb-4">
        <p className="text-sm text-muted">Всего отложено</p>
        <p className="tnum text-3xl font-semibold">
          {totalBase === null
            ? '—'
            : show(() => format.money(totalBase, settings.baseCurrency))}
        </p>
        <p className="tnum text-sm text-muted">
          {totalSecondary === null
            ? 'курс не задан'
            : `≈ ${show(() => format.money(totalSecondary, settings.secondaryCurrency))}`}
        </p>
      </section>

      {backupIsStale(settings.lastBackupAt) && holdings.length > 0 && (
        <div className="px-4 pb-3">
          <Card
            className="flex items-center gap-3 p-3"
            onClick={() => navigate('/settings')}
          >
            <span aria-hidden>💾</span>
            <span className="flex-1 text-sm">
              {settings.lastBackupAt === undefined
                ? 'Вы ещё ни разу не делали бэкап'
                : 'Последний бэкап был больше недели назад'}
            </span>
            <span className="text-sm text-accent">Сделать</span>
          </Card>
        </div>
      )}

      <div className="space-y-3 px-4">
        {ready && buckets.length === 0 && (
          <EmptyState title="Корзин пока нет" hint="Заведите их в настройках." />
        )}

        {buckets.map((bucket) => {
          const bucketHoldings = sortHoldings(
            holdingsByBucket.get(bucket.id) ?? [],
            locationOf,
          );
          const base = convert(bucketHoldings, settings.baseCurrency);
          const secondary = convert(bucketHoldings, settings.secondaryCurrency);
          const hasLoans = bucketHoldings.some(
            (h) => openLoanBuckets?.has(h.locationId) ?? false,
          );

          const content = (
            <>
              <div className="flex items-baseline gap-2">
                <span className="flex-1 truncate font-medium">
                  {bucket.emoji && <span className="mr-1">{bucket.emoji}</span>}
                  {bucket.name}
                </span>
                {hasLoans && (
                  <span
                    className="rounded-full bg-raised px-2 py-0.5 text-xs text-warn"
                    title="В корзине есть открытые займы"
                  >
                    займы
                  </span>
                )}
              </div>

              <p className="tnum mt-1 text-xl font-semibold">
                {base === null
                  ? '—'
                  : show(() => format.money(base, settings.baseCurrency))}
              </p>
              {secondary !== null && base !== null && bucketHoldings.length > 0 && (
                <p className="tnum text-xs text-muted">
                  ≈ {show(() => format.money(secondary, settings.secondaryCurrency))}
                </p>
              )}

              <HoldingList
                holdings={bucketHoldings}
                hidden={hidden}
                nameOf={(id) => locationOf.get(id)?.name ?? '—'}
                money={format.money}
              />
            </>
          );

          // «Нераспределено» — деньги, которые ждут, когда их разложат.
          // Карточка видна всегда, даже пустой: это напоминание о том, что
          // доход можно положить сюда и разобрать позже. Кнопка появляется,
          // только когда есть что раскладывать.
          if (bucket.system === 'unallocated') {
            return (
              <Card key={bucket.id} className="p-4">
                <button
                  type="button"
                  className="w-full text-left active:opacity-70"
                  onClick={() => navigate(`/bucket/${bucket.id}`)}
                >
                  {content}
                </button>
                {bucketHoldings.length > 0 && (
                  <Button
                    className="mt-3 w-full text-sm"
                    onClick={() => navigate(spreadLink(bucket.id, bucketHoldings, format))}
                  >
                    Разложить по корзинам
                  </Button>
                )}
              </Card>
            );
          }

          return (
            <Card
              key={bucket.id}
              className="p-4"
              onClick={() => navigate(`/bucket/${bucket.id}`)}
            >
              {content}
            </Card>
          );
        })}
      </div>

      <div className="safe-bottom fixed inset-x-0 bottom-0 mx-auto max-w-md px-4">
        <Button
          variant="primary"
          size="lg"
          className="w-full shadow-lg"
          onClick={() => navigate('/new')}
        >
          + Операция
        </Button>
      </div>
    </div>
  );
}

/**
 * Ссылка на форму перевода с подставленной самой крупной позицией корзины —
 * обычно её и раскладывают, а поправить сумму можно на месте.
 */
function spreadLink(
  bucketId: string,
  holdings: readonly Holding[],
  format: ReturnType<typeof useAppData>['format'],
): string {
  const biggest = [...holdings].sort((a, b) => b.amount - a.amount)[0];
  const params = new URLSearchParams({ type: 'reallocate', from: bucketId });
  if (biggest) {
    params.set('loc', biggest.locationId);
    params.set('cur', biggest.currency);
    params.set(
      'amount',
      format.amount(biggest.amount, biggest.currency).replace(/\u00A0/g, ''),
    );
  }
  return `/new?${params.toString()}`;
}

/** Компактный блок «Осталось на…»: позиции корзины по местам. */
function HoldingList({
  holdings,
  hidden,
  nameOf,
  money,
}: {
  holdings: readonly Holding[];
  hidden: boolean;
  nameOf: (id: string) => string;
  money: (minor: number, code: string) => string;
}) {
  if (holdings.length === 0) {
    return <p className="mt-2 text-sm text-muted">Пусто</p>;
  }
  return (
    <ul className="mt-2 space-y-0.5">
      {holdings.map((h) => (
        <li
          key={`${h.locationId}-${h.currency}`}
          className={cx('flex gap-2 text-sm', h.amount < 0 && 'text-danger')}
        >
          <span className="tnum">{hidden ? HIDDEN : money(h.amount, h.currency)}</span>
          <span className="truncate text-muted">· {nameOf(h.locationId)}</span>
        </li>
      ))}
    </ul>
  );
}
