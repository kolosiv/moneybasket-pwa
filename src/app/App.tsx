import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ToastProvider } from '../ui/Toast.tsx';
import { getSettings } from '../db/repo.ts';
import { HomeScreen } from '../features/home/HomeScreen.tsx';
import { EntryScreen } from '../features/entry/EntryScreen.tsx';
import { BucketScreen } from '../features/bucket/BucketScreen.tsx';
import { LoansScreen } from '../features/loans/LoansScreen.tsx';
import { OperationsScreen } from '../features/operations/OperationsScreen.tsx';
import { SettingsScreen } from '../features/settings/SettingsScreen.tsx';
import { OnboardingScreen } from '../features/onboarding/OnboardingScreen.tsx';

export function App() {
  // undefined — ещё читаем базу; показывать что-либо рано, иначе на первом
  // кадре мигнёт онбординг поверх уже заведённых данных.
  const onboardedAt = useLiveQuery(
    () => getSettings().then((s) => s.onboardedAt ?? null),
    [],
  );

  if (onboardedAt === undefined) return <Splash />;

  return (
    <ToastProvider>
      <HashRouter>
        <Routes>
          {onboardedAt === null ? (
            <>
              <Route path="/onboarding" element={<OnboardingScreen />} />
              <Route path="*" element={<Navigate to="/onboarding" replace />} />
            </>
          ) : (
            <>
              <Route path="/" element={<HomeScreen />} />
              <Route path="/new" element={<EntryScreen />} />
              <Route path="/op/:operationId" element={<EntryScreen />} />
              <Route path="/bucket/:bucketId" element={<BucketScreen />} />
              <Route path="/operations" element={<OperationsScreen />} />
              <Route path="/loans" element={<LoansScreen />} />
              <Route path="/settings" element={<SettingsScreen />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
      </HashRouter>
    </ToastProvider>
  );
}

function Splash() {
  return <div className="min-h-dvh bg-bg" aria-busy="true" />;
}
