// Снимает скриншоты для README на вымышленных данных.
//
//   npm run dev -- --port 5185 --strictPort   # в одном терминале
//   node tools/screenshots.mjs                # в другом
//
// Каждый запуск идёт в чистом профиле WebKit (iPhone 13): хранилище браузера
// пустое, любые настоящие данные исключены. Курсы НБРБ подменены, дата
// зафиксирована, поэтому кадры воспроизводимы.
import { mkdirSync } from 'node:fs';
import { devices, webkit } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5185';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const COLOR_SCHEME = process.env.COLOR_SCHEME ?? 'dark';
mkdirSync(OUT, { recursive: true });

const RATES = { USD: 3.1628, EUR: 3.4472 };

const browser = await webkit.launch();
const context = await browser.newContext({
  ...devices['iPhone 13'],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: 'ru-RU',
  colorScheme: COLOR_SCHEME,
});
const page = await context.newPage();

await page.clock.setFixedTime(new Date('2025-03-12T10:00:00'));
await page.route('https://api.nbrb.by/**', (route) => {
  const currency = new URL(route.request().url()).pathname.split('/').pop();
  route.fulfill({
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({
      Cur_ID: 0,
      Date: '2025-03-12T00:00:00',
      Cur_Abbreviation: currency,
      Cur_Scale: 1,
      Cur_Name: currency,
      Cur_OfficialRate: RATES[currency] ?? 1,
    }),
  });
});

// Пауза съедает CSS-переходы, чтобы кадр не поймал элемент на полпути.
const shot = async (name) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}${name}.png` });
};
const done = () => page.getByRole('button', { name: 'Готово' }).click();

// ---------- онбординг: стартовые остатки ----------
await page.goto(BASE_URL);
for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Дальше' }).click();
await page.getByLabel('На какую дату').fill('2025-03-01');

const bucketCard = (emoji, name) =>
  page.locator('div').filter({ hasText: new RegExp(`^${emoji} ${name}`) }).last();

/** Добавляет строку остатка: место, сумма, валюта. */
async function addBalance(card, place, amount, currency = 'BYN') {
  await card.getByRole('button', { name: '+ остаток' }).click();
  await card.getByRole('button', { name: place, exact: true }).last().click();
  await card.getByLabel(/^Сумма/).last().fill(amount);
  if (currency !== 'BYN') await card.getByLabel('Валюта').last().selectOption(currency);
}

const big = bucketCard('🛒', 'Крупные покупки');
await addBalance(big, 'Накопительный', '1284,36');
await addBalance(big, 'Наличка', '760');
await addBalance(big, 'Дача', '410', 'USD');
await addBalance(big, 'Копилка', '385', 'USD');
await big.getByRole('button', { name: '+ займ' }).click();
await big.getByLabel('Кто должен').fill('Аня');
await big.getByLabel(/^Сумма/).last().fill('85');

const vacation = bucketCard('🏖', 'Отпуск');
await addBalance(vacation, 'Расчётный счёт', '1750');
await addBalance(vacation, 'Евро-карта', '385,40', 'EUR');
await addBalance(vacation, 'Копилка', '610', 'USD');

const crypto = bucketCard('₿', 'Крипта');
await addBalance(crypto, 'Валютная карта', '412,85', 'USD');
await addBalance(crypto, 'Накопительный', '640');
await done();

// ---------- операции ----------
async function openEntry(type) {
  await page.getByRole('button', { name: '+ Операция' }).click();
  if (type) await page.getByRole('button', { name: type, exact: true }).click();
}

// Отель: обычный расход, вчера.
await openEntry();
await page.getByLabel('Сумма').fill('645,3');
await page.getByRole('button', { name: /^Накопительный/ }).click();
await page.getByLabel('Описание').fill('Отель');
await page.getByRole('button', { name: 'Вчера' }).click();
await done();

// Цветы: раздельная оплата. Этот кадр и есть «быстрый ввод».
await openEntry();
await page.getByLabel('Сумма').first().fill('8');
await page.getByRole('button', { name: /^Накопительный/ }).click();
await page.getByRole('button', { name: '+ ещё место оплаты' }).click();
await page.getByLabel('Сумма').nth(1).fill('120');
await page.getByRole('button', { name: /^Наличка/ }).last().click();
await page.getByLabel('Описание').fill('Цветы');
await shot('02-quick-entry');
await done();

// Такси: сегодня.
await openEntry();
await page.getByLabel('Сумма').fill('18,4');
await page.getByRole('button', { name: /^Накопительный/ }).click();
await page.getByLabel('Описание').fill('Такси');
await done();

// Обмен BYN → USD с курсом.
await openEntry('Обмен');
await page.getByLabel('Отдал').fill('340');
await page.getByLabel('Получил').fill('107,5');
await page.getByRole('button', { name: 'USD', exact: true }).last().click();
await page.getByRole('button', { name: /^Валютная карта/ }).last().click();
await page.getByLabel('Описание').fill('Перелив в доллары');
await done();

// Бэкап, чтобы на главной не висело напоминание.
await page.getByRole('button', { name: 'Настройки' }).click();
const download = page.waitForEvent('download');
await page.getByRole('button', { name: 'Выгрузить всё в JSON' }).click();
await download;
await page.goBack();

// ---------- кадры ----------
await page.getByText('Файл выгружен').waitFor({ state: 'hidden' });
await page.getByRole('button', { name: /Крупные покупки/ }).waitFor();
await shot('01-home');

await page.getByRole('button', { name: /Крупные покупки/ }).click();
await page.getByText('Отель').first().waitFor();
await shot('03-bucket');

await browser.close();
console.log(`Скриншоты записаны в ${OUT}`);
