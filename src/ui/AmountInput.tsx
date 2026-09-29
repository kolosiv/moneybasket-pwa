import { useId } from 'react';
import { cx } from './primitives.tsx';

/**
 * Ввод суммы. Цифровая клавиатура на телефоне, принимает и запятую, и точку.
 * inputMode="decimal" вместо type="number": у number на iOS нет запятой
 * и легко случайно прокрутить значение.
 */
export function AmountInput({
  value,
  onChange,
  suffix,
  autoFocus,
  placeholder = '0',
  size = 'md',
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  suffix?: string | undefined;
  autoFocus?: boolean | undefined;
  placeholder?: string | undefined;
  size?: 'md' | 'lg' | undefined;
  'aria-label'?: string | undefined;
}) {
  const id = useId();
  return (
    <div
      className={cx(
        'flex items-center gap-2 rounded-xl border border-line bg-surface px-3',
        'focus-within:border-accent',
        size === 'lg' ? 'min-h-16' : 'min-h-11',
      )}
    >
      <input
        id={id}
        aria-label={ariaLabel ?? 'Сумма'}
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(sanitize(e.target.value))}
        onFocus={(e) => e.currentTarget.select()}
        className={cx(
          'tnum w-full bg-transparent py-2 outline-none',
          size === 'lg' ? 'text-3xl font-semibold' : '',
        )}
      />
      {suffix !== undefined && (
        <span className={cx('shrink-0 text-muted', size === 'lg' && 'text-xl')}>
          {suffix}
        </span>
      )}
    </div>
  );
}

/** Пропускаем только цифры и один разделитель — чтобы не ловить мусор из буфера. */
function sanitize(raw: string): string {
  const cleaned = raw.replace(/[^\d.,]/g, '').replace('.', ',');
  const first = cleaned.indexOf(',');
  if (first === -1) return cleaned;
  return (
    cleaned.slice(0, first + 1) + cleaned.slice(first + 1).replace(/,/g, '')
  );
}
