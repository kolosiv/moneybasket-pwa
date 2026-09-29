export type PersistStatus = 'persisted' | 'best-effort' | 'unsupported';

/**
 * Safari чистит IndexedDB у сайтов, которыми давно не пользовались.
 * Запрос persist() заметно снижает риск, но гарантии не даёт — статус
 * показываем в настройках, чтобы было видно, на чём мы стоим.
 */
export async function requestPersistence(): Promise<PersistStatus> {
  if (!navigator.storage?.persist) return 'unsupported';
  try {
    if (await navigator.storage.persisted()) return 'persisted';
    return (await navigator.storage.persist()) ? 'persisted' : 'best-effort';
  } catch {
    return 'unsupported';
  }
}

export async function persistStatus(): Promise<PersistStatus> {
  if (!navigator.storage?.persisted) return 'unsupported';
  try {
    return (await navigator.storage.persisted()) ? 'persisted' : 'best-effort';
  } catch {
    return 'unsupported';
  }
}

/** Приложение запущено с домашнего экрана, а не как вкладка Safari. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && navigator.standalone === true)
  );
}
