import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAppData } from '../../app/useAppData.ts';
import { useDescriptions } from '../../db/hooks.ts';
import {
  getOperation,
  saveOperation,
  softDeleteOperation,
} from '../../db/repo.ts';
import { computeHoldings, holdingAmount } from '../../domain/holdings.ts';
import { hasErrors, validateOperation } from '../../domain/validation.ts';
import type { Entry, OperationDraft, OperationType } from '../../domain/types.ts';
import { newId } from '../../domain/operations.ts';
import { Button, Card, Chip, Field, ScreenTitle, cx } from '../../ui/primitives.tsx';
import { AmountInput } from '../../ui/AmountInput.tsx';
import { useToast } from '../../ui/Toast.tsx';
import {
  BucketChips,
  ChipRow,
  CurrencyChips,
  DatePicker,
  DescriptionInput,
  LocationChips,
} from './pickers.tsx';
import {
  ENTRY_TYPES,
  SOURCE_LABELS,
  TYPE_LABELS,
  buildDraft,
  emptyLine,
  formFromDraft,
  initialForm,
  isEntryType,
  readLastUsed,
  writeLastUsed,
  type EntryType,
  type FormState,
  type LineState,
} from './state.ts';

/** Первый ряд переключателя — то, что вносится чаще всего. */
const PRIMARY_TYPES: EntryType[] = ['expense', 'topup', 'move', 'exchange'];
const MORE_TYPES: EntryType[] = ENTRY_TYPES.filter(
  (t) => !PRIMARY_TYPES.includes(t),
);

export function EntryScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const { operationId } = useParams();
  const editing = operationId !== undefined;

  const { ready, buckets, locations, holdings, format, locationOf } = useAppData();
  const descriptions = useDescriptions();

  // Форму можно открыть уже заполненной — так работает «Разложить» на главной.
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState<FormState>(() => prefillFromQuery(searchParams));
  const [showMore, setShowMore] = useState(() =>
    MORE_TYPES.includes(prefillFromQuery(searchParams).type),
  );
  const [loaded, setLoaded] = useState(!editing);
  const [existing, setExisting] = useState<OperationDraft | undefined>(undefined);
  const [attempted, setAttempted] = useState(false);

  const currencyCodes = useMemo(
    () => ['BYN', 'USD', 'EUR', 'USDT'],
    [],
  );

  // Редактирование: восстанавливаем форму из сохранённой операции.
  useEffect(() => {
    if (!editing || !ready || loaded) return;
    let cancelled = false;
    void getOperation(operationId).then((draft) => {
      if (cancelled || !draft) return;
      const restored = formFromDraft(draft, locations, format);
      if (restored) {
        setForm(restored);
        setExisting(draft);
        setShowMore(MORE_TYPES.includes(restored.type));
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [editing, ready, loaded, operationId, locations, format]);

  // Новая операция: подставляем последнюю корзину и место для этого типа.
  useEffect(() => {
    if (editing || !ready || buckets.length === 0) return;
    setForm((prev) => {
      if (prev.bucketId !== '') return prev;
      const last = readLastUsed(prev.type);
      const bucketId =
        last.bucketId && buckets.some((b) => b.id === last.bucketId)
          ? last.bucketId
          : (buckets[0]?.id ?? '');

      // Если места ещё ни разу не выбирали, берём то, где в этой корзине
      // реально лежат деньги, — обычно это и есть нужное.
      const funded = holdings.find(
        (h) =>
          h.bucketId === bucketId &&
          locationOf.get(h.locationId)?.kind !== 'receivable',
      );
      const locationId =
        last.locationId && locations.some((l) => l.id === last.locationId)
          ? last.locationId
          : (funded?.locationId ?? '');
      const currency = funded && locationId === funded.locationId
        ? funded.currency
        : prev.lines[0]?.currency ?? 'BYN';

      return {
        ...prev,
        bucketId,
        lines: prev.lines.map((l, i) =>
          i === 0 ? { ...l, locationId, currency } : l,
        ),
        from: { ...prev.from, locationId, currency },
      };
    });
  }, [editing, ready, buckets, locations, holdings, locationOf]);

  /**
   * При редактировании текущие остатки уже включают проводки этой операции.
   * Чтобы проверка «уходит в минус» не врала, вычитаем их обратно.
   */
  const holdingsBefore = useMemo(() => {
    const asEntries = holdings.map(
      (h): Entry => ({
        id: `holding-${h.bucketId}-${h.locationId}-${h.currency}`,
        operationId: 'holdings',
        bucketId: h.bucketId,
        locationId: h.locationId,
        currency: h.currency,
        amount: h.amount,
      }),
    );
    if (!existing) return holdings;
    const reverted = existing.entries.map(
      (e): Entry => ({ ...e, id: `revert-${e.id}`, amount: -e.amount }),
    );
    return computeHoldings([...asEntries, ...reverted]);
  }, [holdings, existing]);

  const built = useMemo(
    () =>
      buildDraft(
        form,
        format,
        existing
          ? { id: existing.operation.id, createdAt: existing.operation.createdAt }
          : undefined,
      ),
    [form, format, existing],
  );

  const issues = useMemo(() => {
    if (!built.draft) return [];
    return validateOperation(built.draft, {
      locations,
      holdings: existing ? holdingsBefore : holdings,
    });
  }, [built.draft, locations, holdings, holdingsBefore, existing]);

  const blocking = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const canSave = built.draft !== undefined && !hasErrors(issues);

  function patch(update: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...update }));
  }

  function changeType(type: EntryType) {
    const last = readLastUsed(type);
    setForm((prev) => ({
      ...prev,
      type,
      bucketId:
        last.bucketId && buckets.some((b) => b.id === last.bucketId)
          ? last.bucketId
          : prev.bucketId,
      source: type === 'topup' ? prev.source : '',
    }));
    setAttempted(false);
  }

  async function save() {
    setAttempted(true);
    if (!built.draft || !canSave) return;
    const draft = built.draft;

    await saveOperation(draft);
    writeLastUsed(form.type, {
      bucketId: form.bucketId,
      locationId: form.lines[0]?.locationId || form.from.locationId,
    });

    toast({
      text: resultText(draft, holdings, format, locationOf),
      action: {
        label: 'Отменить',
        onPress: async () => {
          if (existing) await saveOperation(existing);
          else await softDeleteOperation(draft.operation.id);
        },
      },
    });
    navigate(-1);
  }

  async function remove() {
    if (!existing) return;
    const snapshot = existing;
    await softDeleteOperation(snapshot.operation.id);
    toast({
      text: 'Операция удалена',
      tone: 'danger',
      action: {
        label: 'Отменить',
        onPress: () => saveOperation(snapshot),
      },
    });
    navigate(-1);
  }

  if (!ready || !loaded) return <div className="min-h-dvh bg-bg" aria-busy="true" />;

  const showSplit = form.type === 'expense' || form.type === 'to_pocket';
  const isLoan = form.type === 'loan_out' || form.type === 'loan_return';
  const isReallocate = form.type === 'reallocate';
  const receivables = locations.filter((l) => l.kind === 'receivable');

  return (
    <div className="mx-auto min-h-dvh max-w-md pb-32">
      <ScreenTitle
        title={editing ? 'Операция' : TYPE_LABELS[form.type]}
        back={() => navigate(-1)}
        right={
          editing ? (
            <Button variant="ghost" className="px-3 text-danger" onClick={() => void remove()}>
              Удалить
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-5 px-4 pt-4">
        <div className="space-y-2">
          <ChipRow>
            {PRIMARY_TYPES.map((type) => (
              <Chip
                key={type}
                selected={form.type === type}
                onClick={() => changeType(type)}
              >
                {TYPE_LABELS[type]}
              </Chip>
            ))}
            <Chip selected={showMore} onClick={() => setShowMore((v) => !v)}>
              Ещё
            </Chip>
          </ChipRow>
          {showMore && (
            <ChipRow>
              {MORE_TYPES.map((type) => (
                <Chip
                  key={type}
                  selected={form.type === type}
                  onClick={() => changeType(type)}
                >
                  {TYPE_LABELS[type]}
                </Chip>
              ))}
            </ChipRow>
          )}
        </div>

        {/* Сумма идёт первой и получает фокус — так вносится быстрее всего. */}
        {!isLoan && !isReallocate && form.type !== 'move' && form.type !== 'exchange' && (
          <div className="space-y-3">
            {form.lines.map((line, index) => (
              <LineEditor
                key={line.id}
                line={line}
                autoFocus={index === 0}
                currencyCodes={currencyCodes}
                onChange={(next) =>
                  patch({
                    lines: form.lines.map((l) => (l.id === line.id ? next : l)),
                  })
                }
                onRemove={
                  form.lines.length > 1
                    ? () => patch({ lines: form.lines.filter((l) => l.id !== line.id) })
                    : undefined
                }
                locations={locations}
                holdings={holdings}
                bucketId={form.bucketId}
                format={format}
              />
            ))}
            {showSplit && (
              <Button
                className="w-full text-sm"
                onClick={() =>
                  patch({
                    lines: [
                      ...form.lines,
                      emptyLine('', form.lines[0]?.currency ?? 'BYN'),
                    ],
                  })
                }
              >
                + ещё место оплаты
              </Button>
            )}
          </div>
        )}

        {form.type === 'move' && (
          <TwoSided
            form={form}
            patch={patch}
            locations={locations}
            holdings={holdings}
            format={format}
            currencyCodes={currencyCodes}
            labels={{ from: 'Откуда', to: 'Куда' }}
            lockCurrency
          />
        )}

        {form.type === 'exchange' && (
          <>
            <TwoSided
              form={form}
              patch={patch}
              locations={locations}
              holdings={holdings}
              format={format}
              currencyCodes={currencyCodes}
              labels={{ from: 'Отдал', to: 'Получил' }}
            />
            <RateHint form={form} format={format} />
            <Field label="Комиссия, необязательно">
              <AmountInput
                value={form.fee}
                aria-label="Комиссия"
                suffix={format.symbol(form.from.currency)}
                onChange={(fee) => patch({ fee })}
              />
            </Field>
          </>
        )}

        {isReallocate && (
          <ReallocateEditor
            form={form}
            patch={patch}
            buckets={buckets}
            locations={locations}
            holdings={holdings}
            format={format}
            currencyCodes={currencyCodes}
          />
        )}

        {isLoan && (
          <LoanEditor
            form={form}
            patch={patch}
            locations={locations}
            receivables={receivables}
            holdings={holdings}
            format={format}
            currencyCodes={currencyCodes}
          />
        )}

        {!isReallocate && (
          <Field label="Корзина">
            <BucketChips
              buckets={buckets}
              value={form.bucketId}
              onChange={(bucketId) => patch({ bucketId })}
            />
          </Field>
        )}

        {form.type === 'topup' && (
          <Field label="Откуда деньги">
            <ChipRow>
              {(Object.keys(SOURCE_LABELS) as (keyof typeof SOURCE_LABELS)[]).map(
                (source) => (
                  <Chip
                    key={source}
                    selected={form.source === source}
                    onClick={() =>
                      patch({ source: form.source === source ? '' : source })
                    }
                  >
                    {SOURCE_LABELS[source]}
                  </Chip>
                ),
              )}
            </ChipRow>
          </Field>
        )}

        <Field label="Описание">
          <DescriptionInput
            value={form.description}
            suggestions={descriptions}
            onChange={(description) => patch({ description })}
          />
        </Field>

        <Field label="Дата">
          <DatePicker value={form.date} onChange={(date) => patch({ date })} />
        </Field>

        {form.type === 'loan_out' && (
          <Field label="Вернуть до, необязательно">
            <input
              type="date"
              value={form.dueDate}
              aria-label="Срок возврата"
              onChange={(e) => patch({ dueDate: e.target.value })}
              className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 outline-none focus:border-accent"
            />
          </Field>
        )}

        {warnings.length > 0 && (
          <Card className="border-warn/40 p-3">
            {warnings.map((issue) => (
              <p key={issue.message} className="text-sm text-warn">
                {issue.message}
              </p>
            ))}
          </Card>
        )}

        {attempted && (blocking.length > 0 || built.problem !== undefined) && (
          <Card className="border-danger/40 p-3">
            {built.problem !== undefined && (
              <p className="text-sm text-danger">{built.problem}</p>
            )}
            {blocking.map((issue) => (
              <p key={issue.message} className="text-sm text-danger">
                {issue.message}
              </p>
            ))}
          </Card>
        )}
      </div>

      <div className="safe-bottom fixed inset-x-0 bottom-0 mx-auto max-w-md border-t border-line bg-bg/95 px-4 pt-3 backdrop-blur">
        <Button variant="primary" size="lg" className="w-full" onClick={() => void save()}>
          {editing ? 'Сохранить' : 'Готово'}
        </Button>
      </div>
    </div>
  );
}

/** Читает подставленные значения из адреса: ?type=&from=&to=&loc=&cur=&amount= */
function prefillFromQuery(params: URLSearchParams): FormState {
  const type = params.get('type');
  if (type === null || !isEntryType(type as OperationType)) return initialForm();

  const locationId = params.get('loc') ?? '';
  const currency = params.get('cur') ?? 'BYN';
  return initialForm({
    type: type as EntryType,
    bucketId: params.get('from') ?? '',
    toBucketId: params.get('to') ?? '',
    from: { id: newId(), locationId, currency, amount: params.get('amount') ?? '' },
    lines: [{ id: newId(), locationId, currency, amount: params.get('amount') ?? '' }],
  });
}

function LineEditor({
  line,
  onChange,
  onRemove,
  locations,
  holdings,
  bucketId,
  format,
  currencyCodes,
  autoFocus,
}: {
  line: LineState;
  onChange: (line: LineState) => void;
  onRemove?: (() => void) | undefined;
  locations: ReturnType<typeof useAppData>['locations'];
  holdings: ReturnType<typeof useAppData>['holdings'];
  bucketId: string;
  format: ReturnType<typeof useAppData>['format'];
  currencyCodes: readonly string[];
  autoFocus?: boolean | undefined;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <AmountInput
            value={line.amount}
            size="lg"
            autoFocus={autoFocus}
            suffix={format.symbol(line.currency)}
            onChange={(amount) => onChange({ ...line, amount })}
          />
        </div>
        {onRemove && (
          <Button variant="ghost" className="px-2 text-danger" onClick={onRemove}>
            ✕
          </Button>
        )}
      </div>
      <LocationChips
        locations={locations}
        holdings={holdings}
        bucketId={bucketId}
        value={line.locationId}
        currency={line.currency}
        format={format}
        onChange={(locationId, currency) =>
          onChange({ ...line, locationId, currency: currency ?? line.currency })
        }
      />
      <CurrencyChips
        codes={currencyCodes}
        value={line.currency}
        onChange={(currency) => onChange({ ...line, currency })}
      />
    </div>
  );
}

function TwoSided({
  form,
  patch,
  locations,
  holdings,
  format,
  currencyCodes,
  labels,
  lockCurrency = false,
}: {
  form: FormState;
  patch: (update: Partial<FormState>) => void;
  locations: ReturnType<typeof useAppData>['locations'];
  holdings: ReturnType<typeof useAppData>['holdings'];
  format: ReturnType<typeof useAppData>['format'];
  currencyCodes: readonly string[];
  labels: { from: string; to: string };
  lockCurrency?: boolean;
}) {
  return (
    <div className="space-y-5">
      <Field label={labels.from}>
        <div className="space-y-2">
          <AmountInput
            value={form.from.amount}
            size="lg"
            autoFocus
            aria-label={labels.from}
            suffix={format.symbol(form.from.currency)}
            onChange={(amount) => patch({ from: { ...form.from, amount } })}
          />
          <LocationChips
            label="Место списания"
            locations={locations}
            holdings={holdings}
            bucketId={form.bucketId}
            value={form.from.locationId}
            currency={form.from.currency}
            format={format}
            onChange={(locationId, currency) =>
              patch({
                from: {
                  ...form.from,
                  locationId,
                  currency: currency ?? form.from.currency,
                },
                ...(lockCurrency && currency
                  ? { to: { ...form.to, currency } }
                  : {}),
              })
            }
          />
          <CurrencyChips
            codes={currencyCodes}
            value={form.from.currency}
            onChange={(currency) =>
              patch({
                from: { ...form.from, currency },
                ...(lockCurrency ? { to: { ...form.to, currency } } : {}),
              })
            }
          />
        </div>
      </Field>

      <Field label={labels.to}>
        <div className="space-y-2">
          {!lockCurrency && (
            <AmountInput
              value={form.to.amount}
              size="lg"
              aria-label={labels.to}
              suffix={format.symbol(form.to.currency)}
              onChange={(amount) => patch({ to: { ...form.to, amount } })}
            />
          )}
          <LocationChips
            label="Место зачисления"
            locations={locations}
            holdings={holdings}
            bucketId={form.bucketId}
            value={form.to.locationId}
            currency={form.to.currency}
            format={format}
            onChange={(locationId) => patch({ to: { ...form.to, locationId } })}
          />
          {!lockCurrency && (
            <CurrencyChips
              codes={currencyCodes}
              value={form.to.currency}
              onChange={(currency) => patch({ to: { ...form.to, currency } })}
            />
          )}
        </div>
      </Field>
    </div>
  );
}

/**
 * Перевод между корзинами. Деньги остаются в том же месте, меняется только
 * то, какой цели они принадлежат. Встречная часть — это когда взамен в
 * исходную корзину уходит другая сумма, обычно в другой валюте.
 */
function ReallocateEditor({
  form,
  patch,
  buckets,
  locations,
  holdings,
  format,
  currencyCodes,
}: {
  form: FormState;
  patch: (update: Partial<FormState>) => void;
  buckets: ReturnType<typeof useAppData>['buckets'];
  locations: ReturnType<typeof useAppData>['locations'];
  holdings: ReturnType<typeof useAppData>['holdings'];
  format: ReturnType<typeof useAppData>['format'];
  currencyCodes: readonly string[];
}) {
  const hasCounter = form.counter.amount !== '' || form.counter.locationId !== '';

  const available = holdingAmount(
    holdings,
    form.bucketId,
    form.from.locationId,
    form.from.currency,
  );

  return (
    <div className="space-y-5">
      <Field label="Сумма">
        <div className="space-y-2">
          <AmountInput
            value={form.from.amount}
            size="lg"
            autoFocus
            suffix={format.symbol(form.from.currency)}
            onChange={(amount) => patch({ from: { ...form.from, amount } })}
          />
          {available !== 0 && (
            <button
              type="button"
              className="tnum text-sm text-accent"
              onClick={() =>
                patch({
                  from: {
                    ...form.from,
                    amount: format
                      .amount(available, form.from.currency)
                      .replace(/\u00A0/g, ''),
                  },
                })
              }
            >
              Доступно {format.money(available, form.from.currency)} — взять всё
            </button>
          )}
        </div>
      </Field>

      <Field label="Из корзины">
        <BucketChips
          label="Из корзины"
          buckets={buckets}
          value={form.bucketId}
          onChange={(bucketId) =>
            patch({
              bucketId,
              ...(form.toBucketId === bucketId ? { toBucketId: '' } : {}),
            })
          }
        />
      </Field>

      <Field label="В корзину">
        <BucketChips
          label="В корзину"
          buckets={buckets.filter((b) => b.id !== form.bucketId)}
          value={form.toBucketId}
          onChange={(toBucketId) => patch({ toBucketId })}
        />
      </Field>

      <Field label="Где лежат деньги">
        <div className="space-y-2">
          <LocationChips
            label="Где лежат деньги"
            locations={locations}
            holdings={holdings}
            bucketId={form.bucketId}
            value={form.from.locationId}
            currency={form.from.currency}
            format={format}
            onChange={(locationId, currency) =>
              patch({
                from: {
                  ...form.from,
                  locationId,
                  currency: currency ?? form.from.currency,
                },
              })
            }
          />
          <CurrencyChips
            codes={currencyCodes}
            value={form.from.currency}
            onChange={(currency) => patch({ from: { ...form.from, currency } })}
          />
        </div>
      </Field>

      {!hasCounter ? (
        <Button
          className="w-full text-sm"
          onClick={() =>
            patch({
              counter: {
                ...form.counter,
                locationId: form.from.locationId,
                currency: form.from.currency === 'BYN' ? 'USD' : 'BYN',
              },
            })
          }
        >
          + встречная часть
        </Button>
      ) : (
        <Field label="Взамен уходит обратно">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <AmountInput
                  value={form.counter.amount}
                  aria-label="Встречная сумма"
                  suffix={format.symbol(form.counter.currency)}
                  onChange={(amount) => patch({ counter: { ...form.counter, amount } })}
                />
              </div>
              <Button
                variant="ghost"
                aria-label="Убрать встречную часть"
                className="px-2 text-danger"
                onClick={() => patch({ counter: emptyLine() })}
              >
                ✕
              </Button>
            </div>
            <LocationChips
              label="Место встречной части"
              locations={locations}
              holdings={holdings}
              bucketId={form.toBucketId}
              value={form.counter.locationId}
              currency={form.counter.currency}
              format={format}
              onChange={(locationId, currency) =>
                patch({
                  counter: {
                    ...form.counter,
                    locationId,
                    currency: currency ?? form.counter.currency,
                  },
                })
              }
            />
            <CurrencyChips
              codes={currencyCodes}
              value={form.counter.currency}
              onChange={(currency) => patch({ counter: { ...form.counter, currency } })}
            />
          </div>
        </Field>
      )}
    </div>
  );
}

function LoanEditor({
  form,
  patch,
  locations,
  receivables,
  holdings,
  format,
  currencyCodes,
}: {
  form: FormState;
  patch: (update: Partial<FormState>) => void;
  locations: ReturnType<typeof useAppData>['locations'];
  receivables: ReturnType<typeof useAppData>['locations'];
  holdings: ReturnType<typeof useAppData>['holdings'];
  format: ReturnType<typeof useAppData>['format'];
  currencyCodes: readonly string[];
}) {
  const out = form.type === 'loan_out';
  const openLoans = holdings.filter(
    (h) =>
      h.bucketId === form.bucketId &&
      receivables.some((r) => r.id === h.locationId) &&
      h.amount !== 0,
  );

  return (
    <div className="space-y-5">
      <Field label="Сумма">
        <div className="space-y-2">
          <AmountInput
            value={form.from.amount}
            size="lg"
            autoFocus
            suffix={format.symbol(form.from.currency)}
            onChange={(amount) => patch({ from: { ...form.from, amount } })}
          />
          <CurrencyChips
            codes={currencyCodes}
            value={form.from.currency}
            onChange={(currency) => patch({ from: { ...form.from, currency } })}
          />
        </div>
      </Field>

      <Field label={out ? 'Кому' : 'Кто возвращает'}>
        <ChipRow>
          {(out ? receivables : receivables).map((r) => {
            const open = openLoans.find((h) => h.locationId === r.id);
            if (!out && !open) return null;
            return (
              <Chip
                key={r.id}
                selected={form.counterpartyId === r.id}
                onClick={() =>
                  patch({
                    counterpartyId: r.id,
                    ...(open && !out
                      ? {
                          from: {
                            ...form.from,
                            currency: open.currency,
                            amount:
                              form.from.amount === ''
                                ? format
                                    .amount(open.amount, open.currency)
                                    .replace(/ /g, '')
                                : form.from.amount,
                          },
                        }
                      : {}),
                  })
                }
              >
                <span>{r.counterparty ?? r.name}</span>
                {open && (
                  <span className="tnum text-xs text-muted">
                    {format.money(open.amount, open.currency)}
                  </span>
                )}
              </Chip>
            );
          })}
        </ChipRow>
        {receivables.length === 0 && (
          <p className="mt-2 text-sm text-muted">
            Контрагентов пока нет — добавьте в настройках.
          </p>
        )}
      </Field>

      <Field label={out ? 'Откуда деньги' : 'Куда пришли'}>
        <LocationChips
          locations={locations}
          holdings={holdings}
          bucketId={form.bucketId}
          value={form.from.locationId}
          currency={form.from.currency}
          format={format}
          onChange={(locationId) => patch({ from: { ...form.from, locationId } })}
        />
      </Field>
    </div>
  );
}

function RateHint({
  form,
  format,
}: {
  form: FormState;
  format: ReturnType<typeof useAppData>['format'];
}) {
  const given = format.parse(form.from.amount, form.from.currency);
  const received = format.parse(form.to.amount, form.to.currency);
  if (!given || !received) return null;
  const rate =
    given /
    10 ** format.decimals(form.from.currency) /
    (received / 10 ** format.decimals(form.to.currency));
  return (
    <p className="tnum text-sm text-muted">
      Курс: {rate.toFixed(4)} {form.from.currency} за 1 {form.to.currency}
    </p>
  );
}

/** Типы, где деньги приходят: показывать остаток интереснее по месту прихода. */
const INFLOW: ReadonlySet<string> = new Set(['topup', 'loan_return', 'move']);

/**
 * Текст тоста после сохранения — новый остаток той позиции, которая для этой
 * операции главная. Для расхода это место списания, для возврата займа —
 * место, куда деньги пришли; место-контрагент не показываем, «осталось 0 на
 * долге» пользователю ничего не говорит.
 */
function resultText(
  draft: OperationDraft,
  holdingsBefore: ReturnType<typeof useAppData>['holdings'],
  format: ReturnType<typeof useAppData>['format'],
  locationOf: ReturnType<typeof useAppData>['locationOf'],
): string {
  const wantPositive = INFLOW.has(draft.operation.type);
  const real = draft.entries.filter(
    (e) => locationOf.get(e.locationId)?.kind !== 'receivable',
  );
  const anchor =
    real.find((e) => (wantPositive ? e.amount > 0 : e.amount < 0)) ??
    real[0] ??
    draft.entries[0];
  if (!anchor) return 'Сохранено';

  const before = holdingAmount(
    holdingsBefore,
    anchor.bucketId,
    anchor.locationId,
    anchor.currency,
  );
  const after = before + anchor.amount;
  const name = locationOf.get(anchor.locationId)?.name ?? '';
  return `Осталось ${format.money(after, anchor.currency)} · ${name}`;
}

export { cx };
