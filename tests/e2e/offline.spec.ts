import { expect, test } from '@playwright/test';

/**
 * Приложение должно работать без сети и переживать перезагрузку —
 * раздел 6 ТЗ и пункт приёмки «после перезагрузки и в авиарежиме всё на месте».
 */
test('данные переживают перезагрузку и авиарежим', async ({ page, context }) => {
  await page.goto('/');

  // Ждём, пока service worker закэширует оболочку.
  await page.waitForFunction(
    async () => (await navigator.serviceWorker.getRegistrations()).length > 0,
    undefined,
    { timeout: 15_000 },
  );
  await expect
    .poll(
      () => page.evaluate(async () => (await caches.keys()).length),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  // Заводим данные.
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: 'Дальше' }).click();
  const card = page.locator('div').filter({ hasText: /^🛒 Крупные покупки/ }).last();
  await card.getByRole('button', { name: '+ остаток' }).click();
  await page.getByLabel('Сумма', { exact: false }).first().fill('1284,36');
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByText('1 284,36 р').first()).toBeVisible();

  // Перезагрузка с сетью.
  await page.reload();
  await expect(page.getByText('1 284,36 р').first()).toBeVisible();

  // Авиарежим.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Корзины' })).toBeVisible();
  await expect(page.getByText('1 284,36 р').first()).toBeVisible();

  // Офлайн операции тоже вносятся.
  await page.getByRole('button', { name: '+ Операция' }).click();
  await page.getByLabel('Сумма').fill('18,4');
  await page.getByRole('button', { name: /Накопительный/ }).click();
  await page.getByLabel('Описание').fill('Такси');
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByText('1 265,96 р').first()).toBeVisible();

  await context.setOffline(false);
});
