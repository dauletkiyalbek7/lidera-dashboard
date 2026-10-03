/**
 * Заявки из таблицы Куралай — в Lidera.
 *
 * Тот же скрипт, что и у Алибека (`alibek-sheet-to-lidera.gs`), и отличается
 * от него только ключом потока и приставкой в ключе защиты от повторов. Один
 * файл на два отдела не сделать: Apps Script живёт внутри своей таблицы и
 * чужой файл подключить не умеет — поэтому их два, и правку нужно вносить в
 * оба.
 *
 * Выгрузка моментальных форм Meta у Куралай живёт своей жизнью: сервис-посредник
 * складывает заявки в Google-таблицу и сам же отправляет их в платформу — но
 * только пока отправка настроена. На новую таблицу её забывают включить, и
 * заявки остаются лежать в таблице.
 *
 * Скрипт ставится на саму таблицу и отправляет строки в поток заявок отдела
 * «Куралай»: платформа по адресу узнаёт и компанию, и отдел, и площадку.
 *
 * Что делает:
 *   sendAll()        — проходит таблицу сверху вниз и отправляет всё, что ещё не
 *                      отправлено. Можно запускать сколько угодно раз: отправленные
 *                      строки помечены в последней колонке и во второй раз не уходят.
 *   installTrigger() — ставит автозапуск раз в 5 минут, чтобы новые строки уезжали
 *                      сами. Разовая настройка.
 *   removeTrigger()  — снять автозапуск.
 *
 * Как поставить:
 *   1. Открыть таблицу → Расширения → Apps Script.
 *   2. Вставить этот файл целиком — адрес потока уже вписан, менять нечего.
 *   3. Запустить sendAll — Google один раз спросит доступ к таблице и к сети.
 *   4. Запустить installTrigger — дальше новые заявки уходят без участия человека.
 *
 * Один и тот же файл ставится на любую таблицу с заявками Куралай: вторая
 * таблица не требует ни второго ключа, ни правок — заявки из обеих попадут в
 * один отдел, а двойников не будет (см. ключ защиты от повторов ниже).
 *
 * Чего скрипт намеренно не делает: ничего в таблице не меняет, кроме своей
 * последней колонки с отметкой об отправке.
 */

/**
 * Поток заявок «Моментальные формы — Куралай» компании Daryn NIS. Ключ выдан
 * на поток, а не на человека: по нему платформа узнаёт компанию, отдел и
 * площадку. Ключ Алибека сюда не подходит — заявки лягут в чужой отдел.
 * Адрес целиком — https://lidera-dashboard.vercel.app/api/forms/ad9a2c88247474de41744885d5299dd5
 */
const WEBHOOK_KEY = 'ad9a2c88247474de41744885d5299dd5';
const WEBHOOK_HOST = 'https://lidera-dashboard.vercel.app';

/**
 * Лист с заявками. Пусто — берём первый лист таблицы. Если выгрузка лежит не на
 * первом листе, впишите его название: иначе скрипт молча читает не тот лист.
 */
const SHEET_NAME = '';

/** Колонка с отметкой об отправке. Заводится сама, справа от данных. */
const STATUS_HEADER = 'Lidera';

/**
 * Google останавливает скрипт на шестой минуте. Останавливаемся сами раньше:
 * прерванный на полпути запуск не успевает пометить отправленное, и те же
 * заявки уходят второй раз.
 */
const RUN_LIMIT_MS = 4.5 * 60 * 1000;

/** Пауза между заявками: тысяча строк залпом — это атака, а не выгрузка. */
const PAUSE_MS = 120;

/**
 * Названия колонок. Выгрузки у всех разные — «Телефон», «phone_number»,
 * «Нөмір», — поэтому колонку ищем по списку знакомых названий, а не по номеру:
 * вставленный кем-то столбец иначе сдвигает всю разметку молча.
 */
const COLUMNS = {
  name: ['full_name', 'name', 'имя', 'фио', 'клиент', 'аты', 'аты-жөні'],
  phone: ['phone_number', 'phone', 'телефон', 'номер', 'нөмір', 'whatsapp', 'тел'],
  leadId: ['id', 'lead_id', 'leadgen_id', 'lead id', 'номер заявки'],
  createdAt: ['created_time', 'created', 'дата', 'дата заявки', 'время', 'date', 'күні'],
  adId: ['ad_id', 'adid', 'объявление'],
  campaign: ['campaign_name', 'campaign', 'кампания'],
  adset: ['adset_name', 'adset', 'группа'],
  formName: ['form_name', 'форма'],
};

function sendAll() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = SHEET_NAME ? book.getSheetByName(SHEET_NAME) : book.getSheets()[0];
  if (!sheet) {
    throw new Error('В таблице нет листа с названием «' + SHEET_NAME + '».');
  }
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    Logger.log('В таблице нет строк с заявками.');
    return;
  }

  const header = values[0].map((cell) => String(cell).trim().toLowerCase());
  const at = {};
  for (const field of Object.keys(COLUMNS)) {
    at[field] = header.findIndex((title) => COLUMNS[field].includes(title));
  }

  if (at.phone < 0 && at.name < 0) {
    throw new Error(
      'Не нашли ни колонку телефона, ни колонку имени. Проверьте первую строку таблицы: ' +
        'в ней должны быть названия колонок.',
    );
  }

  const statusAt = statusColumn_(sheet, header);
  const started = Date.now();
  const tally = { sent: 0, duplicate: 0, failed: 0, skipped: 0, empty: 0 };
  let stoppedAt = 0;

  for (let row = 1; row < values.length; row += 1) {
    if (Date.now() - started > RUN_LIMIT_MS) {
      stoppedAt = row;
      break;
    }

    // Уже отправленную строку второй раз не трогаем. Строку с ошибкой —
    // наоборот, пробуем снова: ошибка бывает и от упавшей на минуту сети.
    const mark = String(values[row][statusAt - 1] || '').trim();
    if (mark && mark.indexOf('ошибка') !== 0) {
      tally.skipped += 1;
      continue;
    }

    const payload = rowPayload_(values[row], at);
    if (!payload) {
      tally.empty += 1;
      continue;
    }

    const outcome = post_(payload);
    sheet.getRange(row + 1, statusAt).setValue(outcome.mark);

    if (outcome.state === 'sent') tally.sent += 1;
    else if (outcome.state === 'duplicate') tally.duplicate += 1;
    else tally.failed += 1;

    Utilities.sleep(PAUSE_MS);
  }

  Logger.log(
    'Отправлено: %s, уже были: %s, не удалось: %s, пропущено: %s, пустых строк: %s',
    tally.sent,
    tally.duplicate,
    tally.failed,
    tally.skipped,
    tally.empty,
  );

  if (stoppedAt) {
    Logger.log(
      'Остановились на строке %s — Google не даёт скрипту работать дольше шести минут. ' +
        'Запустите sendAll ещё раз, он продолжит с этого места.',
      stoppedAt + 1,
    );
  }
}

/** Автозапуск: новые строки уезжают сами. */
function installTrigger() {
  removeTrigger();
  ScriptApp.newTrigger('sendAll').timeBased().everyMinutes(5).create();
  Logger.log('Автозапуск поставлен: раз в 5 минут.');
}

function removeTrigger() {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'sendAll') ScriptApp.deleteTrigger(trigger);
  }
}

/**
 * Строка таблицы → поля заявки.
 *
 * Названия полей — те же, что присылает выгрузка моментальных форм: платформа
 * их уже понимает, и придумывать свои незачем. Приставки вида `p:` и `l:`,
 * которые ставит посредник, снимает сама платформа.
 */
function rowPayload_(row, at) {
  const value = (index) => (index >= 0 ? String(row[index] ?? '').trim() : '');

  const phone = value(at.phone);
  const name = value(at.name);
  if (!phone && !name) return null;

  const created = at.createdAt >= 0 ? row[at.createdAt] : '';
  const createdTime =
    created instanceof Date
      ? created.toISOString()
      : String(created ?? '').trim();

  const payload = {
    full_name: name || 'Заявка',
    phone_number: phone,
    created_time: createdTime,
    ad_id: value(at.adId),
    campaign_name: value(at.campaign),
    adset_name: value(at.adset),
    form_name: value(at.formName),
  };

  const leadId = value(at.leadId);
  if (leadId) {
    // Номер заявки Meta — он же защита от двойников: платформа не создаст
    // второго человека с тем же номером заявки.
    payload.id = leadId;
  } else {
    // Номера заявки в выгрузке нет. Тогда собираем свой устойчивый ключ из
    // телефона и даты: при повторной заливке той же таблицы заявка опознается
    // как та же самая, а не ляжет вторым человеком с тем же номером.
    payload.external_id = 'kuralay-' + phone.replace(/\D/g, '') + '-' + dayOf_(createdTime);
  }

  for (const field of Object.keys(payload)) {
    if (!payload[field]) delete payload[field];
  }

  return payload;
}

/** День заявки для устойчивого ключа. Нет даты — ключ держится на одном телефоне. */
function dayOf_(createdTime) {
  if (!createdTime) return 'нет-даты';
  const parsed = new Date(createdTime);
  if (isNaN(parsed.getTime())) return 'нет-даты';
  return Utilities.formatDate(parsed, 'Asia/Almaty', 'yyyy-MM-dd');
}

function post_(payload) {
  const response = UrlFetchApp.fetch(WEBHOOK_HOST + '/api/forms/' + WEBHOOK_KEY, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  let body = {};
  try {
    body = JSON.parse(response.getContentText());
  } catch (error) {
    body = {};
  }

  if (code !== 200) {
    return { state: 'failed', mark: 'ошибка: платформа ответила ' + code };
  }
  if (body.duplicate) {
    return { state: 'duplicate', mark: 'повтор ' + stamp_() };
  }
  if (body.ok === false) {
    return { state: 'failed', mark: 'ошибка: ' + (body.error || 'без причины') };
  }

  return { state: 'sent', mark: 'отправлено ' + stamp_() };
}

function stamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Almaty', 'dd.MM.yyyy HH:mm');
}

/**
 * Колонка с отметкой об отправке — одна на таблицу.
 *
 * Отметка нужна в самой таблице, а не в памяти скрипта: по ней и человек
 * видит, какие заявки уже в платформе, и повторный запуск не шлёт их заново.
 */
function statusColumn_(sheet, header) {
  const existing = header.indexOf(STATUS_HEADER.toLowerCase());
  if (existing >= 0) return existing + 1;

  const column = header.length + 1;
  sheet.getRange(1, column).setValue(STATUS_HEADER);
  return column;
}
