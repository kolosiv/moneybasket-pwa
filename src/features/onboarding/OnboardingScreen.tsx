import { useMemo, useState } from 'react';
import { db } from '../../db/db.ts';
import {
  defaultBuckets,
  defaultCurrencies,
  defaultLocations,
  makeReceivable,
} from '../../db/seed.ts';
import { saveOperation } from '../../db/repo.ts';
import { buildOpening, newId } from '../../domain/operations.ts';
import type { Bucket, Location, OpeningLine } from './types.ts';
import { makeFormat, todayIso } from '../../app/format.ts';
import { Button, Card, Chip, Field, TextInput, cx } from '../../ui/primitives.tsx';
import { AmountInput } from '../../ui/AmountInput.tsx';

type Step = 'install' | 'buckets' | 'locations' | 'balances';

interface BalanceRow {
  id: string;
  bucketId: string;
  locationId: string;
  currency: string;
  amount: string;
}

interface LoanRow {
  id: string;
  bucketId: string;
  counterparty: string;
  currency: string;
  amount: string;
}

const currencies = defaultCurrencies();
const format = makeFormat(currencies);

export function OnboardingScreen() {
  const [step, setStep] = useState<Step>('install');
  const [buckets, setBuckets] = useState<Bucket[]>(() => defaultBuckets());
  const [locations, setLocations] = useState<Location[]>(() => defaultLocations());
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [date, setDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);

  /** Системную «Нераспределено» в онбординге не показываем и не трогаем. */
  const visibleBuckets = buckets.filter((b) => b.system === undefined);

  async function finish() {
    setSaving(true);
    const receivables = new Map<string, Location>();
    let sort = locations.length;
    for (const loan of loans) {
      const name = loan.counterparty.trim();
      if (name === '' || !receivables.has(name)) {
        if (name !== '') receivables.set(name, makeReceivable(name, sort++));
      }
    }

    const lines: OpeningLine[] = [];
    for (const row of balances) {
      const amount = format.parse(row.amount, row.currency);
      if (amount === null || amount === 0) continue;
      lines.push({
        bucketId: row.bucketId,
        locationId: row.locationId,
        currency: row.currency,
        amount,
      });
    }
    for (const loan of loans) {
      const amount = format.parse(loan.amount, loan.currency);
      const location = receivables.get(loan.counterparty.trim());
      if (amount === null || amount === 0 || !location) continue;
      lines.push({
        bucketId: loan.bucketId,
        locationId: location.id,
        currency: loan.currency,
        amount,
      });
    }

    const allLocations = [...locations, ...receivables.values()];
    await db.transaction(
      'rw',
      [db.buckets, db.locations, db.currencies, db.settings],
      async () => {
        await db.buckets.bulkPut(buckets);
        await db.locations.bulkPut(allLocations);
        await db.currencies.bulkPut(currencies);
      },
    );

    if (lines.length > 0) {
      await saveOperation(buildOpening({ date, lines }));
    }

    await db.settings.put({
      id: 'settings',
      baseCurrency: 'BYN',
      secondaryCurrency: 'USD',
      hideAmounts: false,
      onboardedAt: new Date().toISOString(),
    });
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <div className="flex-1 px-4 pt-8 pb-4">
        {step === 'install' && <InstallStep />}

        {step === 'buckets' && (
          <NameListStep
            title="Корзины"
            hint="Цели, под которые откладываются деньги. Список можно менять и потом."
            items={visibleBuckets.map((b) => ({ id: b.id, name: b.name }))}
            placeholder="Например, Ремонт"
            onRename={(id, name) =>
              setBuckets((prev) => prev.map((b) => (b.id === id ? { ...b, name } : b)))
            }
            onRemove={(id) => {
              setBuckets((prev) => prev.filter((b) => b.id !== id));
              setBalances((prev) => prev.filter((r) => r.bucketId !== id));
              setLoans((prev) => prev.filter((r) => r.bucketId !== id));
            }}
            onAdd={(name) =>
              setBuckets((prev) => [
                ...prev.filter((b) => b.system === undefined),
                { id: newId(), name, archived: false, sort: prev.length },
                ...prev.filter((b) => b.system !== undefined),
              ])
            }
          />
        )}

        {step === 'locations' && (
          <NameListStep
            title="Места хранения"
            hint="Где деньги лежат физически. Контрагентов по займам добавим на следующем шаге."
            items={locations.map((l) => ({ id: l.id, name: l.name }))}
            placeholder="Например, Депозит"
            onRename={(id, name) =>
              setLocations((prev) =>
                prev.map((l) => (l.id === id ? { ...l, name } : l)),
              )
            }
            onRemove={(id) => {
              setLocations((prev) => prev.filter((l) => l.id !== id));
              setBalances((prev) => prev.filter((r) => r.locationId !== id));
            }}
            onAdd={(name) =>
              setLocations((prev) => [
                ...prev,
                { id: newId(), name, kind: 'bank', archived: false, sort: prev.length },
              ])
            }
          />
        )}

        {step === 'balances' && (
          <BalancesStep
            buckets={visibleBuckets}
            locations={locations}
            balances={balances}
            loans={loans}
            date={date}
            onDate={setDate}
            setBalances={setBalances}
            setLoans={setLoans}
          />
        )}
      </div>

      <div className="safe-bottom sticky bottom-0 flex gap-2 border-t border-line bg-bg/95 px-4 pt-3 backdrop-blur">
        {step !== 'install' && (
          <Button onClick={() => setStep(previousStep(step))} className="px-5">
            Назад
          </Button>
        )}
        <Button
          variant="primary"
          size="lg"
          disabled={saving}
          className="flex-1"
          onClick={() => {
            if (step === 'balances') void finish();
            else setStep(nextStep(step));
          }}
        >
          {step === 'balances' ? 'Готово' : 'Дальше'}
        </Button>
      </div>
    </div>
  );
}

const ORDER: Step[] = ['install', 'buckets', 'locations', 'balances'];
const nextStep = (s: Step) => ORDER[Math.min(ORDER.indexOf(s) + 1, ORDER.length - 1)]!;
const previousStep = (s: Step) => ORDER[Math.max(ORDER.indexOf(s) - 1, 0)]!;

function InstallStep() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Корзины</h1>
      <p className="mt-2 text-muted">
        Учёт денег, отложенных под цели. Всё хранится только на этом устройстве.
      </p>

      <Card className="mt-6 p-4">
        <p className="font-medium">Сначала установите приложение на домашний экран</p>
        <p className="mt-2 text-sm text-muted">
          В Safari: «Поделиться» → «На экран „Домой“». Это важно: данные вкладки
          Safari и установленного приложения — <b>разные хранилища</b>, и Safari
          со временем чистит данные сайтов, которыми не пользуются.
        </p>
        <p className="mt-2 text-sm text-muted">
          Если вы сейчас во вкладке браузера — установите приложение и продолжите
          уже в нём, иначе введённое здесь не перенесётся.
        </p>
      </Card>

      <Card className="mt-3 p-4">
        <p className="font-medium">Регулярно делайте экспорт</p>
        <p className="mt-2 text-sm text-muted">
          В настройках есть выгрузка всей базы в JSON. Приложение напомнит, если
          последний бэкап был больше недели назад.
        </p>
      </Card>
    </div>
  );
}

function NameListStep({
  title,
  hint,
  items,
  placeholder,
  onRename,
  onRemove,
  onAdd,
}: {
  title: string;
  hint: string;
  items: { id: string; name: string }[];
  placeholder: string;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onAdd: (name: string) => void;
}) {
  const [draft, setDraft] = useState('');

  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted">{hint}</p>

      <div className="mt-5 space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2">
            <TextInput
              value={item.name}
              aria-label={`Название: ${item.name}`}
              onChange={(e) => onRename(item.id, e.target.value)}
            />
            <Button
              variant="ghost"
              aria-label={`Удалить ${item.name}`}
              className="px-3 text-danger"
              onClick={() => onRemove(item.id)}
            >
              ✕
            </Button>
          </div>
        ))}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const name = draft.trim();
          if (name === '') return;
          onAdd(name);
          setDraft('');
        }}
      >
        <TextInput
          value={draft}
          placeholder={placeholder}
          aria-label={`Добавить: ${title}`}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" className="px-4">
          Добавить
        </Button>
      </form>
    </div>
  );
}

function BalancesStep({
  buckets,
  locations,
  balances,
  loans,
  date,
  onDate,
  setBalances,
  setLoans,
}: {
  buckets: Bucket[];
  locations: Location[];
  balances: BalanceRow[];
  loans: LoanRow[];
  date: string;
  onDate: (value: string) => void;
  setBalances: React.Dispatch<React.SetStateAction<BalanceRow[]>>;
  setLoans: React.Dispatch<React.SetStateAction<LoanRow[]>>;
}) {
  const locationName = useMemo(
    () => new Map(locations.map((l) => [l.id, l.name])),
    [locations],
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold">Стартовые остатки</h1>
      <p className="mt-2 text-sm text-muted">
        Сколько сейчас лежит в каждой корзине и где. Можно оставить пустым и
        завести позже.
      </p>

      <div className="mt-5 mb-5">
        <Field label="На какую дату">
          <TextInput
            type="date"
            value={date}
            aria-label="На какую дату"
            onChange={(e) => onDate(e.target.value)}
          />
        </Field>
      </div>

      {buckets.map((bucket) => {
        const rows = balances.filter((r) => r.bucketId === bucket.id);
        const bucketLoans = loans.filter((r) => r.bucketId === bucket.id);
        return (
          <Card key={bucket.id} className="mb-3 p-3">
            <p className="mb-2 font-medium">
              {bucket.emoji} {bucket.name}
            </p>

            {rows.map((row) => (
              <div key={row.id} className="mb-3 rounded-xl bg-raised p-2">
                <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                  {locations.map((l) => (
                    <Chip
                      key={l.id}
                      selected={row.locationId === l.id}
                      onClick={() =>
                        setBalances((prev) =>
                          prev.map((r) =>
                            r.id === row.id ? { ...r, locationId: l.id } : r,
                          ),
                        )
                      }
                    >
                      {l.name}
                    </Chip>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <AmountInput
                      value={row.amount}
                      aria-label={`Сумма: ${locationName.get(row.locationId) ?? ''}`}
                      onChange={(value) =>
                        setBalances((prev) =>
                          prev.map((r) => (r.id === row.id ? { ...r, amount: value } : r)),
                        )
                      }
                    />
                  </div>
                  <CurrencyPicker
                    value={row.currency}
                    onChange={(currency) =>
                      setBalances((prev) =>
                        prev.map((r) => (r.id === row.id ? { ...r, currency } : r)),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    aria-label="Убрать строку"
                    className="px-2 text-danger"
                    onClick={() =>
                      setBalances((prev) => prev.filter((r) => r.id !== row.id))
                    }
                  >
                    ✕
                  </Button>
                </div>
              </div>
            ))}

            {bucketLoans.map((loan) => (
              <div key={loan.id} className="mb-3 rounded-xl bg-raised p-2">
                <div className="mb-2 flex items-center gap-2">
                  <span className="shrink-0 text-sm text-muted">Долг:</span>
                  <TextInput
                    value={loan.counterparty}
                    placeholder="Кто должен"
                    aria-label="Кто должен"
                    onChange={(e) =>
                      setLoans((prev) =>
                        prev.map((r) =>
                          r.id === loan.id ? { ...r, counterparty: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <AmountInput
                      value={loan.amount}
                      aria-label={`Сумма долга: ${loan.counterparty}`}
                      onChange={(value) =>
                        setLoans((prev) =>
                          prev.map((r) => (r.id === loan.id ? { ...r, amount: value } : r)),
                        )
                      }
                    />
                  </div>
                  <CurrencyPicker
                    value={loan.currency}
                    onChange={(currency) =>
                      setLoans((prev) =>
                        prev.map((r) => (r.id === loan.id ? { ...r, currency } : r)),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    aria-label="Убрать долг"
                    className="px-2 text-danger"
                    onClick={() => setLoans((prev) => prev.filter((r) => r.id !== loan.id))}
                  >
                    ✕
                  </Button>
                </div>
              </div>
            ))}

            <div className="flex gap-2">
              <Button
                className="flex-1 text-sm"
                onClick={() =>
                  setBalances((prev) => [
                    ...prev,
                    {
                      id: newId(),
                      bucketId: bucket.id,
                      locationId: locations[0]?.id ?? '',
                      currency: 'BYN',
                      amount: '',
                    },
                  ])
                }
              >
                + остаток
              </Button>
              <Button
                className="flex-1 text-sm"
                onClick={() =>
                  setLoans((prev) => [
                    ...prev,
                    {
                      id: newId(),
                      bucketId: bucket.id,
                      counterparty: '',
                      currency: 'BYN',
                      amount: '',
                    },
                  ])
                }
              >
                + займ
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function CurrencyPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  return (
    <select
      value={value}
      aria-label="Валюта"
      onChange={(e) => onChange(e.target.value)}
      className={cx(
        'min-h-11 shrink-0 rounded-xl border border-line bg-surface px-2',
        'outline-none focus:border-accent',
      )}
    >
      {currencies.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code}
        </option>
      ))}
    </select>
  );
}
