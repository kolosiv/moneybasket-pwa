import { useId, useMemo } from 'react';
import { Chip, TextInput, cx } from '../../ui/primitives.tsx';
import { formatDateRelative, shiftIso, todayIso, type Format } from '../../app/format.ts';
import type { Bucket, Holding, Location } from '../../domain/types.ts';

/**
 * Ряд чипов. `label` превращает его в именованную группу — нужно там, где
 * на экране несколько похожих рядов и иначе непонятно, к чему относится чип.
 */
export function ChipRow({
  children,
  label,
}: {
  children: React.ReactNode;
  label?: string | undefined;
}) {
  return (
    <div
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
      {...(label !== undefined ? { role: 'group', 'aria-label': label } : {})}
    >
      {children}
    </div>
  );
}

export function BucketChips({
  buckets,
  value,
  onChange,
  label,
}: {
  buckets: readonly Bucket[];
  value: string;
  onChange: (id: string) => void;
  label?: string | undefined;
}) {
  return (
    <ChipRow label={label}>
      {buckets.map((bucket) => (
        <Chip
          key={bucket.id}
          selected={value === bucket.id}
          onClick={() => onChange(bucket.id)}
        >
          {bucket.emoji && <span aria-hidden>{bucket.emoji}</span>}
          {bucket.name}
        </Chip>
      ))}
    </ChipRow>
  );
}

/**
 * Места сортируются так, чтобы сверху были те, где в этой корзине реально
 * есть деньги, — и сразу с остатком, как просит раздел 5.2 ТЗ.
 */
export function LocationChips({
  locations,
  holdings,
  bucketId,
  value,
  currency,
  onChange,
  format,
  includeReceivable = false,
  label,
}: {
  locations: readonly Location[];
  holdings: readonly Holding[];
  bucketId: string;
  value: string;
  currency?: string;
  onChange: (id: string, currency?: string) => void;
  format: Format;
  includeReceivable?: boolean;
  label?: string | undefined;
}) {
  const ranked = useMemo(() => {
    const funded = new Map<string, Holding[]>();
    for (const h of holdings) {
      if (h.bucketId !== bucketId) continue;
      const list = funded.get(h.locationId);
      if (list) list.push(h);
      else funded.set(h.locationId, [h]);
    }

    return locations
      .filter((l) => includeReceivable || l.kind !== 'receivable')
      .map((location) => ({ location, holdings: funded.get(location.id) ?? [] }))
      .sort((a, b) => {
        const fundedA = a.holdings.length > 0 ? 0 : 1;
        const fundedB = b.holdings.length > 0 ? 0 : 1;
        if (fundedA !== fundedB) return fundedA - fundedB;
        return a.location.sort - b.location.sort;
      });
  }, [locations, holdings, bucketId, includeReceivable]);

  return (
    <ChipRow label={label}>
      {ranked.map(({ location, holdings: own }) => {
        // Подсказываем остаток именно в выбранной валюте, если она уже задана.
        const relevant = currency ? own.filter((h) => h.currency === currency) : own;
        const hint = relevant
          .map((h) => format.money(h.amount, h.currency))
          .join(' · ');
        return (
          <Chip
            key={location.id}
            selected={value === location.id}
            onClick={() => onChange(location.id, own[0]?.currency)}
          >
            <span>{location.name}</span>
            {hint !== '' && (
              <span className="tnum text-xs text-muted">{hint}</span>
            )}
          </Chip>
        );
      })}
    </ChipRow>
  );
}

export function CurrencyChips({
  codes,
  value,
  onChange,
}: {
  codes: readonly string[];
  value: string;
  onChange: (code: string) => void;
}) {
  if (codes.length <= 1) return null;
  return (
    <ChipRow>
      {codes.map((code) => (
        <Chip key={code} selected={value === code} onClick={() => onChange(code)}>
          {code}
        </Chip>
      ))}
    </ChipRow>
  );
}

export function DescriptionInput({
  value,
  onChange,
  suggestions,
  placeholder = 'Описание',
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: readonly string[];
  placeholder?: string;
}) {
  const listId = useId();
  return (
    <>
      <TextInput
        value={value}
        list={listId}
        placeholder={placeholder}
        aria-label="Описание"
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {suggestions.slice(0, 50).map((text) => (
          <option key={text} value={text} />
        ))}
      </datalist>
    </>
  );
}

export function DatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (iso: string) => void;
}) {
  const today = todayIso();
  const yesterday = shiftIso(today, -1);
  const isOther = value !== today && value !== yesterday;

  return (
    <div className="flex items-center gap-2">
      <Chip selected={value === today} onClick={() => onChange(today)}>
        Сегодня
      </Chip>
      <Chip selected={value === yesterday} onClick={() => onChange(yesterday)}>
        Вчера
      </Chip>
      <label
        className={cx(
          'min-h-11 flex flex-1 items-center rounded-full border px-3 text-sm',
          isOther ? 'border-accent bg-accent-soft' : 'border-line bg-surface',
        )}
      >
        <span className="sr-only">Дата операции</span>
        <input
          type="date"
          value={value}
          aria-label="Дата операции"
          onChange={(e) => e.target.value !== '' && onChange(e.target.value)}
          className="w-full bg-transparent outline-none"
        />
      </label>
    </div>
  );
}

export function dateHint(iso: string): string {
  return formatDateRelative(iso);
}
