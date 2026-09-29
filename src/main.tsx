import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { requestPersistence } from './app/storage.ts';
import { syncRatesOnStart } from './db/nbrb.ts';
import { todayIso } from './app/format.ts';
import './index.css';

// Просим браузер не вычищать базу — до первого рендера, чтобы запрос
// пришёлся на пользовательский запуск приложения.
void requestPersistence();

// Подтягиваем курсы Нацбанка, если сегодняшних ещё нет. Молча: без курсов
// приложение работает, просто не покажет строку «≈».
void syncRatesOnStart(todayIso());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
