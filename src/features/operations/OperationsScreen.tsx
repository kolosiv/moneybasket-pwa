import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppData } from '../../app/useAppData.ts';
import { db } from '../../db/db.ts';
import {
  listDeletedOperations,
  listOperations,
  restoreOperation,
} from '../../db/repo.ts';
import { formatDate, formatMonth, monthOf } from '../../app/format.ts';
import {
  Button,
  Card,
  EmptyState,
  ScreenTitle,
  TextInput,
  cx,
} from '../../ui/primitives.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { DayGroups, buildRows, describeOperation } from './OperationList.tsx';
import type { OperationRow } from './OperationList.tsx';

export function OperationsScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const { ready, format, bucketOf } = useAppData();

  const rows = useLiveQuery(async (): Promise<OperationRow[]> => {
    const [operations, entries] = await Promise.all([
      listOperations(),
      db.entries.toArray(),
    ]);
    return buildRows(operations, entries);
  }, []);

  const deleted = useLiveQuery(async (): Promise<OperationRow[]> => {
    const [operations, entries] = await Promise.all([
      listDeletedOperations(),
      db.entries.toArray(),
    ]);
    return buildRows(operations, entries);
  }, []);

  const [month, setMonth] = useState<string | 'all'>('all');
  const [query, setQuery] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);

  const months = useMemo(() => {
    const set = new Set((rows ?? []).map((r) => monthOf(r.operation.date)));
    return [...set].sort().reverse();
  }, [rows]);

  const bucketNameOf = (id: string) => bucketOf.get(id)?.name ?? '';

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (rows ?? []).filter((row) => {
      if (month !== 'all' && monthOf(row.operation.date) !== month) return false;
      if (needle === '') return true;
      // Ищем и по описанию, и по типу с корзинами — так находится
      // «обмен» или «отпуск», даже если в описании этих слов нет.
      const haystack = [
        row.operation.description,
        describeOperation(row),
        ...row.bucketIds.map(bucketNameOf),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, month, query, bucketOf]);

  async function restore(row: OperationRow) {
    await restoreOperation(row.operation.id);
    toast({
      text: `Операция «${row.operation.description || describeOperation(row)}» восстановлена`,
    });
  }

  if (!ready || rows === undefined) {
    return <div className="min-h-dvh bg-bg" aria-busy="true" />;
  }

  const filtering = month !== 'all' || query.trim() !== '';

  return (
    <div className="mx-auto min-h-dvh max-w-md pb-28">
      <ScreenTitle title="Операции" back={() => navigate('/')} />

      <div className="px-4 pt-4">
        <TextInput
          type="search"
          value={query}
          placeholder="Поиск по описанию"
          aria-label="Поиск по операциям"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {months.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
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

      <div className="mt-4 px-4">
        {visible.length === 0 ? (
          <EmptyState
            title={filtering ? 'Ничего не нашлось' : 'Операций пока нет'}
            hint={
              filtering
                ? 'Попробуйте другой месяц или слово.'
                : 'Нажмите «+ Операция» на главной.'
            }
          />
        ) : (
          <>
            <p className="mb-2 text-sm text-muted">
              {visible.length === rows.length
                ? `Всего операций: ${rows.length}`
                : `Показано ${visible.length} из ${rows.length}`}
            </p>
            <DayGroups
              rows={visible}
              format={format}
              bucketNameOf={bucketNameOf}
              onOpen={(id) => navigate(`/op/${id}`)}
            />
          </>
        )}

        {deleted !== undefined && deleted.length > 0 && (
          <div className="mt-8">
            <Button
              variant="ghost"
              className="px-0 text-sm"
              onClick={() => setShowDeleted((v) => !v)}
            >
              {showDeleted ? '▾' : '▸'} Удалённые ({deleted.length})
            </Button>

            {showDeleted && (
              <div className="mt-2 space-y-1.5">
                {deleted.map((row) => (
                  <Card key={row.operation.id} className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-muted line-through">
                        {row.operation.description || describeOperation(row)}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {formatDate(row.operation.date)} · {describeOperation(row)}
                      </p>
                    </div>
                    <Button
                      className="shrink-0 text-sm"
                      onClick={() => void restore(row)}
                    >
                      Вернуть
                    </Button>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
