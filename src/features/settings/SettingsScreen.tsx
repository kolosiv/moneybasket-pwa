import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../../app/useAppData.ts';
import { useAllBuckets, useAllLocations, useRates } from '../../db/hooks.ts';
import { db } from '../../db/db.ts';
import {
  BackupFormatError,
  backupFileName,
  exportBackup,
  importBackup,
  markBackedUp,
  parseBackup,
} from '../../db/backup.ts';
import { putRate } from '../../db/repo.ts';
import { NBRB_CURRENCIES, refreshNbrbRates } from '../../db/nbrb.ts';
import { makeReceivable } from '../../db/seed.ts';
import { newId } from '../../domain/operations.ts';
import { latestRates } from '../../domain/convert.ts';
import { todayIso } from '../../app/format.ts';
import { persistStatus, type PersistStatus } from '../../app/storage.ts';
import {
  Button,
  Card,
  Field,
  ScreenTitle,
  TextInput,
  cx,
} from '../../ui/primitives.tsx';
import { useToast } from '../../ui/Toast.tsx';
import type { Location } from '../../domain/types.ts';

export function SettingsScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const { settings } = useAppData();

  return (
    <div className="mx-auto min-h-dvh max-w-md pb-16">
      <ScreenTitle title="Настройки" back={() => navigate('/')} />

      <div className="space-y-6 px-4 pt-4">
        <BackupSection toast={toast} lastBackupAt={settings.lastBackupAt} />
        <RatesSection />
        <BucketsSection />
        <LocationsSection />
        <StorageSection />
      </div>
    </div>
  );
}

// ─── бэкап ──────────────────────────────────────────────────────────────────

function BackupSection({
  toast,
  lastBackupAt,
}: {
  toast: ReturnType<typeof useToast>;
  lastBackupAt: string | undefined;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function doExport() {
    const backup = await exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = backupFileName();
    link.click();
    URL.revokeObjectURL(url);
    await markBackedUp();
    toast({ text: 'Файл выгружен' });
  }

  async function doImport(text: string) {
    try {
      const file = parseBackup(text);
      await importBackup(file);
      toast({ text: 'Данные заменены из файла' });
    } catch (error) {
      toast({
        text:
          error instanceof BackupFormatError
            ? error.message
            : 'Не удалось прочитать файл',
        tone: 'danger',
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <section>
      <h2 className="mb-2 font-medium">Данные</h2>
      <Card className="space-y-3 p-4">
        <p className="text-sm text-muted">
          {lastBackupAt === undefined
            ? 'Бэкапов ещё не было.'
            : `Последний бэкап: ${new Date(lastBackupAt).toLocaleString('ru-RU')}`}
        </p>
        <Button variant="primary" className="w-full" onClick={() => void doExport()}>
          Выгрузить всё в JSON
        </Button>
        <Button className="w-full" onClick={() => fileInput.current?.click()}>
          Загрузить из JSON
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setPending(await file.text());
          }}
        />
        <p className="text-xs text-muted">
          Загрузка полностью заменяет текущие данные.
        </p>
      </Card>

      {pending !== null && (
        <Card className="mt-2 border-danger/50 p-4">
          <p className="text-sm">
            Все текущие данные будут заменены содержимым файла. Это нельзя отменить.
          </p>
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" onClick={() => setPending(null)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => void doImport(pending)}
            >
              Заменить
            </Button>
          </div>
        </Card>
      )}
    </section>
  );
}

// ─── курсы ──────────────────────────────────────────────────────────────────

function RatesSection() {
  const rates = useRates() ?? [];
  const latest = latestRates(rates);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; text: string } | { kind: 'error'; text: string }
  >({ kind: 'idle' });

  async function save(currency: string) {
    const raw = (drafts[currency] ?? '').replace(',', '.');
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    await putRate({
      date: todayIso(),
      currency,
      bynPerUnit: value,
      source: 'manual',
    });
    setDrafts((prev) => ({ ...prev, [currency]: '' }));
    setStatus({ kind: 'idle' });
  }

  async function refresh() {
    setStatus({ kind: 'loading' });
    const { updated, failed } = await refreshNbrbRates();

    if (failed.length === 0) {
      setStatus({ kind: 'done', text: `Обновлено: ${updated.map((r) => r.currency).join(', ')}` });
      return;
    }
    if (updated.length === 0) {
      setStatus({ kind: 'error', text: failed[0]!.reason });
      return;
    }
    setStatus({
      kind: 'error',
      text: `${updated.map((r) => r.currency).join(', ')} обновлены, ${failed
        .map((f) => f.currency)
        .join(', ')} — нет: ${failed[0]!.reason}`,
    });
  }

  return (
    <section>
      <h2 className="mb-2 font-medium">Курсы</h2>
      <Card className="space-y-3 p-4">
        <p className="text-sm text-muted">
          Сколько рублей за единицу валюты. Нужны только для строки «≈» на главной.
          USDT считается равным доллару.
        </p>

        <Button
          variant="primary"
          className="w-full"
          disabled={status.kind === 'loading'}
          onClick={() => void refresh()}
        >
          {status.kind === 'loading' ? 'Загружаем…' : 'Обновить с НБРБ'}
        </Button>

        {status.kind === 'done' && (
          <p className="text-sm text-ok">{status.text}</p>
        )}
        {status.kind === 'error' && (
          <p className="text-sm text-warn">
            {status.text} Курс можно ввести вручную ниже.
          </p>
        )}

        {NBRB_CURRENCIES.map((currency) => {
          const current = latest.get(currency);
          return (
            <Field
              key={currency}
              label={currency}
              hint={
                current
                  ? `Сейчас: ${current.bynPerUnit} — ${current.date}, ${
                      current.source === 'nbrb' ? 'с НБРБ' : 'вручную'
                    }`
                  : 'Курс не задан'
              }
            >
              <div className="flex gap-2">
                <TextInput
                  inputMode="decimal"
                  placeholder="3,1500"
                  aria-label={`Курс ${currency}`}
                  value={drafts[currency] ?? ''}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [currency]: e.target.value }))
                  }
                />
                <Button className="px-4" onClick={() => void save(currency)}>
                  ОК
                </Button>
              </div>
            </Field>
          );
        })}
      </Card>
    </section>
  );
}

// ─── справочники ────────────────────────────────────────────────────────────

function BucketsSection() {
  const buckets = useAllBuckets() ?? [];
  const [draft, setDraft] = useState('');

  return (
    <section>
      <h2 className="mb-2 font-medium">Корзины</h2>
      <Card className="space-y-2 p-4">
        {buckets.map((bucket) => (
          <NameRow
            key={bucket.id}
            name={bucket.name}
            archived={bucket.archived}
            system={bucket.system !== undefined}
            onRename={(name) => void db.buckets.update(bucket.id, { name })}
            onToggleArchive={() =>
              void db.buckets.update(bucket.id, { archived: !bucket.archived })
            }
          />
        ))}
        <AddRow
          value={draft}
          onChange={setDraft}
          placeholder="Новая корзина"
          onAdd={async (name) => {
            await db.buckets.put({
              id: newId(),
              name,
              archived: false,
              sort: buckets.length,
            });
          }}
        />
      </Card>
    </section>
  );
}

function LocationsSection() {
  const locations = useAllLocations() ?? [];
  const [draft, setDraft] = useState('');
  const [counterparty, setCounterparty] = useState('');

  const real = locations.filter((l) => l.kind !== 'receivable');
  const receivables = locations.filter((l) => l.kind === 'receivable');

  return (
    <section>
      <h2 className="mb-2 font-medium">Места хранения</h2>
      <Card className="space-y-2 p-4">
        {real.map((location) => (
          <LocationRow key={location.id} location={location} />
        ))}
        <AddRow
          value={draft}
          onChange={setDraft}
          placeholder="Новое место"
          onAdd={async (name) => {
            await db.locations.put({
              id: newId(),
              name,
              kind: 'bank',
              archived: false,
              sort: locations.length,
            });
          }}
        />
      </Card>

      <h2 className="mt-4 mb-2 font-medium">Контрагенты по займам</h2>
      <Card className="space-y-2 p-4">
        {receivables.map((location) => (
          <LocationRow key={location.id} location={location} />
        ))}
        <AddRow
          value={counterparty}
          onChange={setCounterparty}
          placeholder="Кому одалживаете"
          onAdd={async (name) => {
            await db.locations.put(makeReceivable(name, locations.length));
          }}
        />
      </Card>
    </section>
  );
}

function LocationRow({ location }: { location: Location }) {
  return (
    <NameRow
      name={location.name}
      archived={location.archived}
      onRename={(name) =>
        void db.locations.update(location.id, {
          name,
          ...(location.kind === 'receivable'
            ? { counterparty: name.replace(/^Долг:\s*/, '') }
            : {}),
        })
      }
      onToggleArchive={() =>
        void db.locations.update(location.id, { archived: !location.archived })
      }
    />
  );
}

/**
 * Переименование и архивирование. Удаления нет намеренно: по ТЗ запись с
 * проводками удалять нельзя, а архив решает ту же задачу без потери истории.
 */
function NameRow({
  name,
  archived,
  system,
  onRename,
  onToggleArchive,
}: {
  name: string;
  archived: boolean;
  system?: boolean;
  onRename: (name: string) => void;
  onToggleArchive: () => void;
}) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);

  return (
    <div className="flex items-center gap-2">
      <TextInput
        value={value}
        aria-label={`Название: ${name}`}
        disabled={system}
        className={cx(archived && 'opacity-50')}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const next = value.trim();
          if (next !== '' && next !== name) onRename(next);
          else setValue(name);
        }}
      />
      {!system && (
        <Button
          variant="ghost"
          className="shrink-0 px-2 text-xs"
          onClick={onToggleArchive}
        >
          {archived ? 'Вернуть' : 'В архив'}
        </Button>
      )}
    </div>
  );
}

function AddRow({
  value,
  onChange,
  placeholder,
  onAdd,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onAdd: (name: string) => Promise<void>;
}) {
  return (
    <form
      className="flex gap-2 pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        const name = value.trim();
        if (name === '') return;
        void onAdd(name).then(() => onChange(''));
      }}
    >
      <TextInput
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button type="submit" className="px-4">
        +
      </Button>
    </form>
  );
}

// ─── хранилище ──────────────────────────────────────────────────────────────

function StorageSection() {
  const [status, setStatus] = useState<PersistStatus | null>(null);

  useEffect(() => {
    void persistStatus().then(setStatus);
  }, []);

  const text: Record<PersistStatus, string> = {
    persisted: 'Браузер обещал не удалять данные автоматически.',
    'best-effort':
      'Браузер не дал постоянного хранения — данные могут быть очищены, если долго не заходить. Установите приложение на домашний экран и регулярно делайте бэкап.',
    unsupported: 'Браузер не поддерживает постоянное хранение.',
  };

  return (
    <section>
      <h2 className="mb-2 font-medium">Хранилище</h2>
      <Card className="p-4">
        <p className="text-sm text-muted">
          {status === null ? 'Проверяем…' : text[status]}
        </p>
      </Card>
    </section>
  );
}
