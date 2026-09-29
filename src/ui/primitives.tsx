import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Все нажимаемые элементы — не меньше 44 px, как требует раздел 6 ТЗ. */
const TAP = 'min-h-11';

export function cx(...parts: (string | false | undefined | null)[]): string {
  return parts.filter(Boolean).join(' ');
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: ButtonProps) {
  const styles = {
    primary: 'bg-accent text-accent-ink font-semibold active:opacity-80',
    secondary: 'bg-raised text-ink active:opacity-70',
    ghost: 'text-muted active:opacity-60',
    danger: 'bg-raised text-danger active:opacity-70',
  }[variant];

  return (
    <button
      type="button"
      {...rest}
      className={cx(
        TAP,
        'inline-flex items-center justify-center gap-2 rounded-xl px-4',
        'transition disabled:opacity-40 disabled:active:opacity-40',
        size === 'lg' && 'min-h-14 text-lg',
        styles,
        className,
      )}
    />
  );
}

export function Chip({
  selected,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      {...rest}
      className={cx(
        TAP,
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm',
        'border transition active:opacity-70',
        selected
          ? 'border-accent bg-accent-soft text-ink font-medium'
          : 'border-line bg-surface text-muted',
        className,
      )}
    />
  );
}

export function Card({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string | undefined;
  onClick?: (() => void) | undefined;
}) {
  const base = 'rounded-card bg-surface border border-line';
  if (!onClick) return <div className={cx(base, className)}>{children}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(base, 'w-full text-left active:opacity-70', className)}
    >
      {children}
    </button>
  );
}

/**
 * Подпись над полем или группой чипов. Намеренно не <label>: внутри часто
 * лежит не один контрол, а ряд кнопок, и label перехватывает их доступные
 * имена — скринридер читает каждый чип как подпись группы. Имя несёт сам
 * контрол через aria-label, здесь — только видимый заголовок.
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm text-muted">{label}</span>
      {children}
      {hint !== undefined && (
        <span className="mt-1 block text-xs text-muted">{hint}</span>
      )}
    </div>
  );
}

export function TextInput({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cx(
        TAP,
        'w-full rounded-xl border border-line bg-surface px-3 py-2',
        'outline-none focus:border-accent',
        className,
      )}
    />
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string | undefined;
}) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-ink">{title}</p>
      {hint !== undefined && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function ScreenTitle({
  title,
  right,
  back,
}: {
  title: string;
  right?: ReactNode | undefined;
  back?: (() => void) | undefined;
}) {
  return (
    <header className="safe-top sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
      <div className="flex items-center gap-1 px-2 pb-2">
        {back && (
          <Button variant="ghost" onClick={back} aria-label="Назад" className="px-2">
            ←
          </Button>
        )}
        <h1 className={cx('flex-1 truncate text-lg font-semibold', !back && 'px-2')}>
          {title}
        </h1>
        {right}
      </div>
    </header>
  );
}
