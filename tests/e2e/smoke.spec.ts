import { expect, test, type Page } from '@playwright/test';

/** Проходит первые три шага онбординга и заводит один стартовый остаток. */
async function onboardWith(page: Page, amount: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: 'Дальше' }).click();
  const card = page.locator('div').filter({ hasText: /^🛒 Крупные покупки/ }).last();
  await card.getByRole('button', { name: '+ остаток' }).click();
  await page.getByLabel('Сумма', { exact: false }).first().fill(amount);
  return card;
}

/**
 * Smoke основного сценария: онбординг со стартовыми остатками → расход →
 * остаток пересчитался.
 */

async function fillAmount(page: Page, index: number, value: string) {
  await page.getByLabel('Сумма', { exact: false }).nth(index).fill(value);
}

test('онбординг, расход и пересчёт остатка', async ({ page }) => {
  await page.goto('/');

  // Шаг 1: предупреждение про установку.
  await expect(page.getByText('установите приложение на домашний экран')).toBeVisible();
  await page.getByRole('button', { name: 'Дальше' }).click();

  // Шаг 2: корзины предзаполнены.
  await expect(page.getByRole('textbox', { name: 'Название: Крупные покупки' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Название: Отпуск' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Название: Крипта' })).toBeVisible();
  await page.getByRole('button', { name: 'Дальше' }).click();

  // Шаг 3: места.
  await expect(page.getByRole('textbox', { name: 'Название: Накопительный' })).toBeVisible();
  await page.getByRole('button', { name: 'Дальше' }).click();

  // Шаг 4: стартовые остатки Крупных покупок.
  await expect(page.getByRole('heading', { name: 'Стартовые остатки' })).toBeVisible();
  const bucketCard = page.locator('div').filter({ hasText: /^🛒 Крупные покупки/ }).last();

  await bucketCard.getByRole('button', { name: '+ остаток' }).click();
  await fillAmount(page, 0, '1284,36');

  await bucketCard.getByRole('button', { name: '+ остаток' }).click();
  await page.getByRole('button', { name: 'Наличка' }).last().click();
  await fillAmount(page, 1, '760');

  await bucketCard.getByRole('button', { name: '+ займ' }).click();
  await page.getByLabel('Кто должен').fill('Аня');
  await fillAmount(page, 2, '85');

  await page.getByRole('button', { name: 'Готово' }).click();

  // Главная: позиции как в блоке «Осталось на…».
  await expect(page.getByRole('heading', { name: 'Корзины' })).toBeVisible();
  await expect(page.getByText('1 284,36 р')).toBeVisible();
  await expect(page.getByText('760,00 р')).toBeVisible();
  await expect(page.getByText('· Долг: Аня')).toBeVisible();
  await expect(page.getByText('займы')).toBeVisible();

  // Расход 18,4 такси с накопительного.
  await page.getByRole('button', { name: '+ Операция' }).click();
  await expect(page.getByLabel('Сумма')).toBeFocused();
  await page.getByLabel('Сумма').fill('18,4');
  await page.getByRole('button', { name: /Накопительный/ }).click();
  await page.getByLabel('Описание').fill('Такси');
  await page.getByRole('button', { name: 'Готово' }).click();

  // Остаток пересчитался, тост показывает новую сумму.
  await expect(page.getByText('Осталось 1 265,96 р · Накопительный')).toBeVisible();
  await expect(page.getByText('1 265,96 р').first()).toBeVisible();

  // Отмена возвращает как было.
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(page.getByText('1 284,36 р').first()).toBeVisible();
});

test('займ виден на экране займов', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: 'Дальше' }).click();

  const bucketCard = page.locator('div').filter({ hasText: /^🛒 Крупные покупки/ }).last();
  await bucketCard.getByRole('button', { name: '+ остаток' }).click();
  await fillAmount(page, 0, '1400');
  await bucketCard.getByRole('button', { name: '+ займ' }).click();
  await page.getByLabel('Кто должен').fill('Брат');
  await fillAmount(page, 1, '120');
  await page.getByRole('button', { name: 'Готово' }).click();

  await page.getByRole('button', { name: 'Займы', exact: true }).click();
  await expect(page.getByText('Брат')).toBeVisible();
  await expect(page.getByText('120,00 р')).toBeVisible();
  await expect(page.getByText('из «Крупные покупки»')).toBeVisible();
});


test('обмен валют считает курс и меняет обе позиции', async ({ page }) => {
  await onboardWith(page, '2600');
  await page.getByRole('button', { name: 'Готово' }).click();

  await page.getByRole('button', { name: '+ Операция' }).click();
  await page.getByRole('button', { name: 'Обмен', exact: true }).click();

  await page.getByLabel('Отдал').fill('850');
  await page.getByLabel('Получил').fill('268,75');
  await page.getByRole('button', { name: 'USD', exact: true }).last().click();

  // Курс из золотого теста 3.
  await expect(page.getByText('3.1628', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: /^Валютная карта/ }).last().click();
  await page.getByRole('button', { name: 'Готово' }).click();

  await expect(page.getByText('1 750,00 р').first()).toBeVisible();
  await expect(page.getByText('268,75 $').first()).toBeVisible();
});

test('возврат займа закрывает долг', async ({ page }) => {
  const card = await onboardWith(page, '1400');
  await card.getByRole('button', { name: '+ займ' }).click();
  await page.getByLabel('Кто должен').fill('Аня');
  await page.getByLabel('Сумма', { exact: false }).nth(1).fill('85');
  await page.getByRole('button', { name: 'Готово' }).click();

  await expect(page.getByText('· Долг: Аня')).toBeVisible();

  await page.getByRole('button', { name: '+ Операция' }).click();
  await page.getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.getByRole('button', { name: 'Вернули долг' }).click();

  // Сумма долга подставляется сама — возврат целиком вносится в два тапа.
  await page.getByRole('button', { name: /^Аня/ }).click();
  await expect(page.getByLabel('Сумма', { exact: false }).first()).toHaveValue('85,00');

  await page.getByRole('button', { name: /^Накопительный/ }).click();
  await page.getByRole('button', { name: 'Готово' }).click();

  // Тост показывает место прихода, а не обнулённый долг.
  await expect(page.getByText('Осталось 1 485,00 р · Накопительный')).toBeVisible();

  // Долг закрыт: позиция пропала из корзины, открытых займов не осталось.
  await expect(page.getByText('1 485,00 р').first()).toBeVisible();
  await expect(page.getByText('займы')).toHaveCount(0);
  await page.getByRole('button', { name: 'Займы', exact: true }).click();
  await expect(page.getByText('Открытых займов нет')).toBeVisible();
});

test('экспорт и импорт возвращают данные как было', async ({ page }, testInfo) => {
  await onboardWith(page, '1284,36');
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByText('1 284,36 р').first()).toBeVisible();

  // Экспорт: файл скачивается с датой в имени.
  await page.getByRole('button', { name: 'Настройки' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Выгрузить всё в JSON' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^moneybasket-\d{4}-\d{2}-\d{2}\.json$/);
  const backupPath = testInfo.outputPath('backup.json');
  await download.saveAs(backupPath);

  // Портим данные: добавляем лишний расход.
  await page.goBack();
  await page.getByRole('button', { name: '+ Операция' }).click();
  await page.getByLabel('Сумма').fill('480');
  await page.getByRole('button', { name: /Накопительный/ }).click();
  await page.getByLabel('Описание').fill('Лишняя трата');
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByText('804,36 р').first()).toBeVisible();

  // Импорт с подтверждением возвращает состояние на момент экспорта.
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: 'Загрузить из JSON' }).click();
  await page.locator('input[type="file"]').setInputFiles(backupPath);
  await page.getByRole('button', { name: 'Заменить' }).click();
  await expect(page.getByText('Данные заменены из файла')).toBeVisible();

  await page.goBack();
  await expect(page.getByText('1 284,36 р').first()).toBeVisible();
  await expect(page.getByText('Лишняя трата')).toHaveCount(0);
});

test('раздельная оплата, редактирование и удаление операции', async ({ page }) => {
  const card = await onboardWith(page, '1400');
  await card.getByRole('button', { name: '+ остаток' }).click();
  await page.getByRole('button', { name: 'Наличка' }).last().click();
  await page.getByLabel('Сумма', { exact: false }).nth(1).fill('760');
  await page.getByRole('button', { name: 'Готово' }).click();

  // Цветы за 147 р: 135 р наличкой + 12 р с накопительного.
  await page.getByRole('button', { name: '+ Операция' }).click();
  await page.getByLabel('Сумма').first().fill('12');
  await page.getByRole('button', { name: /^Накопительный/ }).click();
  await page.getByRole('button', { name: '+ ещё место оплаты' }).click();
  await page.getByLabel('Сумма').nth(1).fill('135');
  await page.getByRole('button', { name: /^Наличка/ }).last().click();
  await page.getByLabel('Описание').fill('Цветы');
  await page.getByRole('button', { name: 'Готово' }).click();

  await expect(page.getByText('1 388,00 р').first()).toBeVisible();
  await expect(page.getByText('625,00 р').first()).toBeVisible();

  // Открываем операцию из корзины и правим сумму.
  await page.getByRole('button', { name: /Крупные покупки/ }).click();
  await page.getByRole('button', { name: /Цветы/ }).click();
  await expect(page.getByLabel('Сумма').first()).toHaveValue('12,00');
  await page.getByLabel('Сумма').first().fill('25');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('1 375,00 р').first()).toBeVisible();

  // Удаление с отменой возвращает операцию.
  await page.getByRole('button', { name: /Цветы/ }).click();
  await page.getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByText('Операция удалена')).toBeVisible();
  await expect(page.getByText('1 400,00 р').first()).toBeVisible();
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(page.getByText('1 375,00 р').first()).toBeVisible();
});

test('деньги из «Нераспределено» раскладываются по корзинам', async ({ page }) => {
  // Заводим отпускные так, как они пришли: на счёт, но ещё без цели.
  await onboardWith(page, '1400');
  await page.getByRole('button', { name: 'Готово' }).click();

  await page.getByRole('button', { name: '+ Операция' }).click();
  await page.getByRole('button', { name: 'Пополнение', exact: true }).click();
  await page.getByLabel('Сумма').fill('2861,35');
  await page.getByRole('button', { name: /^Накопительный/ }).click();
  await page.getByRole('button', { name: 'Нераспределено' }).click();
  await page.getByRole('button', { name: 'Отпускные' }).click();
  await page.getByLabel('Описание').fill('Отпускные с прошлого месяца');
  await page.getByRole('button', { name: 'Готово' }).click();

  await expect(page.getByText('2 861,35 р').first()).toBeVisible();

  // Раскладываем часть в Отпуск прямо с карточки.
  await page.getByRole('button', { name: 'Разложить по корзинам' }).click();
  await expect(page.getByLabel('Сумма')).toHaveValue('2861,35');
  await expect(page.getByText('взять всё')).toBeVisible();

  await page.getByLabel('Сумма').first().fill('1900');
  await page
    .getByRole('group', { name: 'В корзину' })
    .getByRole('button', { name: 'Отпуск' })
    .click();
  await page.getByRole('button', { name: 'Готово' }).click();

  // В Нераспределено остался хвост, в Отпуске появились деньги.
  await expect(page.getByText('961,35 р').first()).toBeVisible();
  await expect(page.getByText('1 900,00 р').first()).toBeVisible();

  // Остаток раскладываем целиком — корзина исчезает с главной.
  await page.getByRole('button', { name: 'Разложить по корзинам' }).click();
  await page
    .getByRole('group', { name: 'В корзину' })
    .getByRole('button', { name: 'Крупные покупки' })
    .click();
  await page.getByRole('button', { name: 'Готово' }).click();

  // Карточка остаётся на главной даже пустой, но раскладывать уже нечего.
  await expect(page.getByText('Нераспределено')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Разложить по корзинам' }),
  ).toHaveCount(0);
  await expect(page.getByText('2 361,35 р').first()).toBeVisible();
});

test('встречный перевод между корзинами сохраняет общий итог', async ({ page }) => {
  const card = await onboardWith(page, '1400');
  await card.getByRole('button', { name: '+ остаток' }).click();
  await page.getByLabel('Сумма', { exact: false }).nth(1).fill('268,75');
  await page.getByLabel('Валюта').nth(1).selectOption('USD');
  await page.getByRole('button', { name: 'Готово' }).click();

  await expect(page.getByText('268,75 $').first()).toBeVisible();

  await page.getByRole('button', { name: '+ Операция' }).click();
  await page.getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.getByRole('button', { name: 'Между корзинами' }).click();

  // Крупные покупки отдают доллары Крипте и получают взамен рубли.
  await page.getByLabel('Сумма').first().fill('268,75');
  await page.getByRole('button', { name: 'USD', exact: true }).first().click();
  await page
    .getByRole('group', { name: 'В корзину' })
    .getByRole('button', { name: 'Крипта' })
    .click();
  await page.getByRole('button', { name: '+ встречная часть' }).click();
  await page.getByLabel('Встречная сумма').fill('860');
  await page.getByRole('button', { name: 'Готово' }).click();

  // Доллары ушли из Крупных покупок, рубли пришли; в Крипте наоборот.
  await expect(page.getByText('268,75 $').first()).toBeVisible();
  await expect(page.getByText('2 260,00 р').first()).toBeVisible();
});

test('экран «Операции» показывает всё за всё время, ищет и возвращает удалённое', async ({
  page,
}) => {
  await onboardWith(page, '1400');
  await page.getByRole('button', { name: 'Готово' }).click();

  // Две операции в разных корзинах плюс перемещение с нулевым итогом.
  await page.getByRole('button', { name: '+ Операция' }).click();
  await page.getByLabel('Сумма').first().fill('18,4');
  await page.getByRole('button', { name: /^Накопительный/ }).click();
  await page.getByLabel('Описание').fill('Такси');
  await page.getByRole('button', { name: 'Готово' }).click();

  await page.getByRole('button', { name: '+ Операция' }).click();
  await page.getByRole('button', { name: 'Пополнение', exact: true }).click();
  await page.getByLabel('Сумма').first().fill('440');
  await page.getByRole('button', { name: /^Накопительный/ }).click();
  // exact: нужен, иначе чип источника «Отпускные» тоже подходит.
  await page.getByRole('button', { name: 'Отпуск', exact: true }).click();
  await page.getByLabel('Описание').fill('Отпускные');
  await page.getByRole('button', { name: 'Готово' }).click();

  await page.getByRole('button', { name: '+ Операция' }).click();
  await page.getByRole('button', { name: 'Перемещение', exact: true }).click();
  await page.getByLabel('Откуда').fill('260');
  await page
    .getByRole('group', { name: 'Место зачисления' })
    .getByRole('button', { name: /^Наличка/ })
    .click();
  await page.getByRole('button', { name: 'Готово' }).click();

  // Открываем экран по иконке-часам.
  await page.getByRole('button', { name: 'Операции' }).click();
  await expect(page.getByRole('heading', { name: 'Операции' })).toBeVisible();

  // Видно операции обеих корзин, и в подписи указано, какую корзину задело.
  await expect(page.getByText('Расход · Крупные покупки')).toBeVisible();
  await expect(page.getByText('Пополнение · Отпуск')).toBeVisible();
  await expect(page.getByText('Стартовый остаток · Крупные покупки')).toBeVisible();

  // У перемещения нулевой итог, поэтому показана переложенная сумма.
  await expect(page.getByText('260,00 р').first()).toBeVisible();

  // Поиск сужает список.
  await page.getByLabel('Поиск по операциям').fill('такси');
  await expect(page.getByText('Такси')).toBeVisible();
  await expect(page.getByText('Отпускные')).toHaveCount(0);

  await page.getByLabel('Поиск по операциям').fill('ничего такого');
  await expect(page.getByText('Ничего не нашлось')).toBeVisible();
  await page.getByLabel('Поиск по операциям').fill('');

  // Удаляем операцию и возвращаем её из блока «Удалённые».
  await page.getByRole('button', { name: /Такси/ }).click();
  await page.getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByText('Операция удалена')).toBeVisible();

  await expect(page.getByText('Такси')).toHaveCount(0);
  await page.getByRole('button', { name: /Удалённые \(1\)/ }).click();
  await page.getByRole('button', { name: 'Вернуть' }).click();
  await expect(page.getByText('восстановлена')).toBeVisible();
  // Проверяем строку ленты, а не тост: в тосте название тоже упомянуто.
  await expect(page.getByText('Расход · Крупные покупки')).toBeVisible();

  // Остаток вернулся к прежнему.
  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(page.getByText('1 121,60 р').first()).toBeVisible();
});
