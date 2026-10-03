/**
 * Заливка покупок из выгрузки amoCRM — в платформу.
 *
 * У Алибека продажи живут в amoCRM, а в платформе их нет вовсе: ни заявок, ни
 * покупок. Поэтому скрипт заливает и то и другое из одного файла — выгрузка
 * сделок знает и клиента, и дату обращения, и сумму, и кто продал.
 *
 * Почему не через адрес приёма заявок: тот умеет только создавать лида. Сумму
 * покупки, дату закрытия и продажника он не принимает, и принимать не должен —
 * это не заявка с сайта, а готовая сделка. Поэтому пишем прямо в базу
 * сервисным ключом, с машины владельца.
 *
 * Запуск:
 *   node scripts/import-sales.mjs <файл> --dry-run                 — проверка без записи
 *   node scripts/import-sales.mjs <файл> --skip-unknown            — только совпавшие
 *   node scripts/import-sales.mjs <файл>                           — совпавшие и новые
 *
 * Сначала всегда --dry-run: он ничего не пишет, а показывает, как понял файл и
 * что уедет. Повторный запуск того же файла безопасен: заявка опознаётся по
 * номеру сделки amoCRM, а покупка — по заявке, к которой она привязана.
 *
 * Берём только выигранные сделки: «Успешно реализовано». Остальные этапы — это
 * не покупка, и в отчёте о доходе им делать нечего.
 */

import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

/** Кому заливаем. Имена, а не номера: их видно в интерфейсе и легко сверить. */
const COMPANY = 'Daryn NIS';
const LEAD_SOURCE = 'Моментальные формы — Алибек';
/** Этап amoCRM, который считаем покупкой. */
const WON_STAGE = 'Успешно реализовано';
/** Что купили. В выгрузке колонка «Продукт» пустая, а в карточке продажи нужна подпись. */
const PRODUCT = 'Курс НИШ';
/** Часовой пояс проекта: даты в выгрузке записаны местным временем, без смещения. */
const TZ_OFFSET = '+05:00';

/**
 * Названия колонок. Телефон ищем по трём: в выгрузке он лежит то в мобильном,
 * то в рабочем — у каждой карточки по-своему.
 */
const COLUMNS = {
  dealId: ['ID'],
  dealName: ['Название сделки'],
  amount: ['Бюджет ₸', 'Бюджет'],
  seller: ['Ответственный'],
  createdAt: ['Дата создания сделки'],
  closedAt: ['Дата закрытия'],
  stage: ['Этап сделки'],
  funnel: ['Воронка'],
  contact: ['Полное имя контакта'],
  phone: ['Мобильный телефон', 'Рабочий телефон', 'Другой телефон', 'Рабочий прямой телефон'],
  email: ['Личный email', 'Рабочий email', 'Другой email'],
};

/**
 * Рекламные метки. В выгрузке колонки с одинаковыми названиями встречаются
 * дважды: первый набор — из отчёта вебинарной комнаты, он пустой, второй — от
 * рекламного кабинета. Берём последнюю непустую, иначе метка теряется.
 */
const MARK_COLUMNS = {
  utm_source: 'utm_source',
  utm_campaign: 'utm_campaign',
  utm_content: 'utm_content',
  utm_medium: 'utm_medium',
  utm_term: 'utm_term',
};

function usage(problem) {
  if (problem) console.error(`\n${problem}\n`);
  console.error(
    'Запуск: node scripts/import-sales.mjs <выгрузка.csv> [--dry-run] [--limit=N] ' +
      `[--company="${COMPANY}"] [--source="${LEAD_SOURCE}"] [--product="${PRODUCT}"]\n`,
  );
  process.exit(problem ? 1 : 0);
}

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith('--'));
const option = (name) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
};

if (!file) usage('Не указан файл выгрузки.');

const dryRun = args.includes('--dry-run');
/**
 * Не заводить людей, которых платформа не знает.
 *
 * Покупку правильнее дописать в живую заявку: у неё есть дата обращения,
 * площадка и креатив, из которых и считается цена продажи. Карточка, собранная
 * из выгрузки amoCRM, ничего этого не знает — она только раздувает число
 * заявок. С этим ключом несовпавшие сделки не заливаются вовсе, а выводятся
 * списком: по нему видно, чьих заявок в платформе не хватает.
 */
const skipUnknown = args.includes('--skip-unknown');
const limit = Number(option('limit') ?? 0) || Infinity;
const companyName = option('company') ?? COMPANY;
const sourceName = option('source') ?? LEAD_SOURCE;
const product = option('product') ?? PRODUCT;

/**
 * Разбор CSV. Учитываем кавычки: в выгрузке внутри полей лежат отчёты
 * вебинарной комнаты — с запятыми и переводами строк.
 */
function parseCsv(text) {
  const clean = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];

    if (quoted) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }

  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows.filter((line) => line.some((value) => value && value.trim()));
}

/** Все номера колонок с таким названием — их бывает несколько. */
function indexesOf(header, name) {
  return header.reduce((found, title, index) => {
    if (title.trim() === name) found.push(index);
    return found;
  }, []);
}

/** Первое непустое значение среди колонок с такими названиями. */
function pick(row, header, names) {
  for (const name of names) {
    for (const index of indexesOf(header, name)) {
      const value = String(row[index] ?? '').trim();
      if (value) return value;
    }
  }
  return '';
}

/** Последнее непустое значение — для меток, где первый набор колонок пустой. */
function pickLast(row, header, name) {
  const found = indexesOf(header, name)
    .map((index) => String(row[index] ?? '').trim())
    .filter(Boolean);
  return found.length ? found[found.length - 1] : null;
}

/**
 * Телефон из выгрузки. amoCRM ставит перед номером апостроф, чтобы Excel не
 * считал его числом; в карточке клиента «'+77026261947» — номер, по которому
 * нельзя позвонить.
 */
function phoneOf(raw) {
  const value = raw.replace(/^'/, '').trim();
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return value;
}

/**
 * Дата из выгрузки: «30.09.2026 22:37:00» местным временем. Без смещения
 * сервер прочитал бы её как UTC, и вся история сдвинулась бы на пять часов —
 * вечерние продажи уехали бы на следующий день.
 */
function momentOf(raw) {
  const match = String(raw ?? '').match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;
  const [, day, month, year, hour = '00', minute = '00', second = '00'] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${TZ_OFFSET}`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** День продажи в часовом поясе проекта, а не в UTC. */
function dayOf(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Almaty',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Площадка заявки. В метке кабинета «ig» и «fb» — это один Meta. */
function platformOf(utmSource) {
  switch (utmSource?.trim().toLowerCase()) {
    case 'ig':
    case 'fb':
    case 'instagram':
    case 'facebook':
    case 'meta':
      return 'meta';
    case 'tiktok':
    case 'tt':
      return 'tiktok';
    default:
      return null;
  }
}

/** Ключ и адрес базы берём из .env.local — отдельной настройки для скрипта нет. */
async function env() {
  const text = await readFile(new URL('../.env.local', import.meta.url), 'utf8').catch(() => '');
  const values = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? values.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? values.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      'Не нашли адрес базы или сервисный ключ. Нужны NEXT_PUBLIC_SUPABASE_URL и ' +
        'SUPABASE_SERVICE_ROLE_KEY — в .env.local или в переменных окружения.',
    );
    process.exit(1);
  }

  return { url, key };
}

const text = await readFile(file, 'utf8');
const rows = parseCsv(text);

if (rows.length < 2) {
  console.error('В файле нет строк со сделками — в первой строке ожидаются названия колонок.');
  process.exit(1);
}

const header = rows[0];
const deals = [];
const tally = { skippedStage: 0, noContact: 0, noDate: 0, zeroAmount: [] };

for (const row of rows.slice(1)) {
  const stage = pick(row, header, COLUMNS.stage);
  if (stage !== WON_STAGE) {
    tally.skippedStage += 1;
    continue;
  }

  const dealId = pick(row, header, COLUMNS.dealId);
  const name = pick(row, header, COLUMNS.contact) || pick(row, header, COLUMNS.dealName);
  const phone = phoneOf(pick(row, header, COLUMNS.phone));

  if (!phone && !name) {
    tally.noContact += 1;
    continue;
  }

  const closed = momentOf(pick(row, header, COLUMNS.closedAt));
  if (!closed) {
    tally.noDate += 1;
    continue;
  }

  const amount = Number(pick(row, header, COLUMNS.amount).replace(/\s/g, '')) || 0;
  if (!amount) tally.zeroAmount.push(dealId);

  const marks = {};
  for (const [field, column] of Object.entries(MARK_COLUMNS)) {
    marks[field] = pickLast(row, header, column);
  }

  deals.push({
    dealId,
    name: name || 'Покупка из amoCRM',
    phone,
    // Цифры телефона — тот же вид, что у `leads.phone_digits`: по ним и ищем
    // человека, который уже лежит в «Лидах».
    phoneDigits: phone ? phone.replace(/\D/g, '') : '',
    email: pick(row, header, COLUMNS.email) || null,
    amount,
    seller: pick(row, header, COLUMNS.seller) || null,
    // Дата обращения честнее даты заливки: иначе месяц старых заявок ляжет
    // на один день, и цена заявки в отчёте перестанет сходиться с расходом.
    arrived: momentOf(pick(row, header, COLUMNS.createdAt)) ?? closed,
    closed,
    marks,
  });
}

console.log(`Файл: ${file}`);
console.log(`Сделок со этапом «${WON_STAGE}»: ${deals.length}`);
if (tally.skippedStage) console.log(`Пропущено по этапу (не покупка): ${tally.skippedStage}`);
if (tally.noContact) console.log(`Пропущено без имени и телефона: ${tally.noContact}`);
if (tally.noDate) console.log(`Пропущено без даты закрытия: ${tally.noDate}`);

const total = deals.reduce((sum, deal) => sum + deal.amount, 0);
console.log(`Сумма покупок: ${total.toLocaleString('ru-RU')} ₸`);
if (tally.zeroAmount.length) {
  console.log(
    `Сделок без суммы: ${tally.zeroAmount.length} (amoCRM ${tally.zeroAmount.join(', ')}) — ` +
      'уедут нулём, сумму лучше поправить в amoCRM и залить файл заново.',
  );
}

if (!deals.length) process.exit(0);

if (dryRun) {
  console.log('\nПервые три записи так, как они уедут:');
  for (const deal of deals.slice(0, 3)) {
    console.log({
      заявка: { имя: deal.name, телефон: deal.phone, пришла: deal.arrived.toISOString() },
      покупка: { сумма: deal.amount, день: dayOf(deal.closed), продал: deal.seller },
      метки: deal.marks,
    });
  }
  console.log(`\nПроверка без записи: уехало бы ${Math.min(deals.length, limit)} покупок.`);
}

const { url, key } = await env();
const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: company, error: companyError } = await supabase
  .from('companies')
  .select('id, name')
  .eq('name', companyName)
  .maybeSingle();

if (companyError || !company) {
  console.error(`Не нашли компанию «${companyName}»: ${companyError?.message ?? 'нет такой'}`);
  process.exit(1);
}

const { data: source, error: sourceError } = await supabase
  .from('lead_sources')
  .select('id, name, platform, department_id')
  .eq('company_id', company.id)
  .eq('name', sourceName)
  .maybeSingle();

if (sourceError || !source) {
  console.error(`Не нашли поток заявок «${sourceName}»: ${sourceError?.message ?? 'нет такого'}`);
  process.exit(1);
}

console.log(`\nКомпания: ${company.name} | поток: ${source.name}`);

/**
 * Заявка, к которой нужно привязать покупку.
 *
 * Покупателя почти всегда уже приняла платформа: заявка пришла из моментальной
 * формы, а покупку записали в amoCRM. Создавать его второй карточкой нельзя —
 * сломаются и воронка, и цена заявки, и отчёт по отделу. Поэтому ищем дважды:
 * сначала по номеру сделки amoCRM (повторная заливка того же файла), потом по
 * телефону. Если один и тот же человек оставлял заявку несколько раз, берём ту,
 * что лежит в отделе этого потока, а среди них — самую первую: покупка выросла
 * из первого обращения, и расход на него уже посчитан.
 */
async function findLead(supabase, companyId, source, deal, externalId) {
  const { data: byExternal, error: externalError } = await supabase
    .from('leads')
    .select('id')
    .eq('company_id', companyId)
    .eq('external_id', externalId)
    .maybeSingle();

  if (externalError) throw externalError;
  if (byExternal) return { lead: byExternal, how: 'external' };

  if (!deal.phoneDigits) return { lead: null, how: 'none' };

  // Ищем по последним десяти цифрам, а не по номеру целиком.
  //
  // Один и тот же человек записан у нас то как +7 747…, то как 8 747…: в
  // моментальной форме он пишет номер сам, как привык. Цифры при этом разные
  // («77476572838» и «87476572838»), и сравнение целиком объявляет его новым
  // человеком — покупка уходит в пустую карточку, а живая заявка остаётся без
  // продажи. Десять цифр — это номер без кода страны и без местной восьмёрки,
  // он у человека один.
  const tail = deal.phoneDigits.slice(-10);

  const { data: byPhone, error: phoneError } = await supabase
    .from('leads')
    .select('id, department_id, external_id, status')
    .eq('company_id', companyId)
    .like('phone_digits', `%${tail}`)
    .order('created_at', { ascending: true });

  if (phoneError) throw phoneError;
  if (!byPhone?.length) return { lead: null, how: 'none' };

  const inDepartment = byPhone.find((lead) => lead.department_id === source.department_id);
  return { lead: inDepartment ?? byPhone[0], how: 'phone' };
}

// Проверка без записи всё равно читает базу: главный вопрос перед заливкой —
// сколько покупателей платформа уже знает. Создать их второй карточкой хуже,
// чем не залить вовсе.
if (dryRun) {
  const look = { matched: 0, repeat: 0, fresh: 0, noPhone: 0 };
  for (const deal of deals) {
    const { lead, how } = await findLead(supabase, company.id, source, deal, `amo-${deal.dealId}`);
    if (how === 'external') look.repeat += 1;
    else if (lead) look.matched += 1;
    else if (!deal.phoneDigits) look.noPhone += 1;
    else look.fresh += 1;
  }

  console.log(
    `Покупка ляжет в заявку, которая уже есть: ${look.matched}. ` +
      `Новых заявок создастся: ${look.fresh}. ` +
      `Уже залито раньше: ${look.repeat}. Без телефона (ляжет новой): ${look.noPhone}.`,
  );
  console.log('Если разметка верна — запустите без --dry-run.');
  process.exit(0);
}

const result = { leads: 0, leadsExisting: 0, leadsMatched: 0, sales: 0, salesExisting: 0, failed: 0 };
/** Сделки, человека которых платформа не знает. При --skip-unknown — весь улов. */
const unknown = [];
const problems = [];
let done = 0;

for (const deal of deals) {
  if (done >= limit) break;
  done += 1;

  // Номер сделки amoCRM — он же защита от двойников: при повторной заливке
  // заявка опознаётся как та же самая, а не ложится вторым человеком.
  const externalId = `amo-${deal.dealId}`;

  try {
    const { lead: existing, how } = await findLead(supabase, company.id, source, deal, externalId);

    let leadId = existing?.id ?? null;

    if (existing && how === 'external') {
      result.leadsExisting += 1;
    } else if (existing) {
      // Человек уже есть — дописываем ему покупку и переводим в конец воронки.
      // Номер сделки ставим только в пустое поле: его мог занять другой экспорт.
      const patch = { status: 'sale' };
      if (!existing.external_id) patch.external_id = externalId;

      const { error } = await supabase.from('leads').update(patch).eq('id', existing.id);
      if (error) throw error;
      result.leadsMatched += 1;
    } else if (skipUnknown) {
      unknown.push(deal);
      continue;
    } else {
      const { data: created, error } = await supabase
        .from('leads')
        .insert({
          company_id: company.id,
          name: deal.name,
          phone: deal.phone,
          email: deal.email,
          source: source.platform ?? 'meta',
          platform: platformOf(deal.marks.utm_source) ?? 'meta',
          department_id: source.department_id,
          lead_source_id: source.id,
          external_id: externalId,
          // Человек уже купил — в воронке ему место на последнем шаге.
          status: 'sale',
          created_at: deal.arrived.toISOString(),
          utm_source: deal.marks.utm_source,
          utm_medium: deal.marks.utm_medium,
          utm_campaign: deal.marks.utm_campaign,
          utm_content: deal.marks.utm_content,
          utm_term: deal.marks.utm_term,
        })
        .select('id')
        .single();

      if (error) throw error;
      leadId = created.id;
      result.leads += 1;
    }

    const { data: sale } = await supabase
      .from('sales')
      .select('id')
      .eq('company_id', company.id)
      .eq('lead_id', leadId)
      .eq('status', 'paid')
      .maybeSingle();

    if (sale) {
      result.salesExisting += 1;
      continue;
    }

    const { error: saleError } = await supabase.from('sales').insert({
      company_id: company.id,
      lead_id: leadId,
      product,
      amount: deal.amount,
      status: 'paid',
      sale_date: dayOf(deal.closed),
      // Продажника кладём именем: сотрудников этого отдела в платформе ещё нет,
      // а в карточке продажи должно быть видно, кто закрыл.
      seller_name: deal.seller,
    });

    if (saleError) throw saleError;
    result.sales += 1;
  } catch (error) {
    result.failed += 1;
    problems.push(`сделка ${deal.dealId}: ${error instanceof Error ? error.message : 'ошибка'}`);
  }

  if (done % 25 === 0) console.log(`…обработано ${done} из ${deals.length}`);
}

console.log(
  `\nГотово. Покупка привязана к заявке, которая уже была: ${result.leadsMatched}. ` +
    `Новых заявок создано: ${result.leads}, залито повторно: ${result.leadsExisting}. ` +
    `Покупок создано: ${result.sales}, уже были: ${result.salesExisting}. Ошибок: ${result.failed}.`,
);

if (unknown.length) {
  console.log(`\nЗаявки этих покупателей в платформе нет — ${unknown.length} из ${deals.length}:`);
  for (const deal of unknown) {
    console.log(
      `  ${deal.phone || 'без телефона'}  ${deal.name}  ` +
        `${deal.amount.toLocaleString('ru-RU')} ₸  закрыто ${dayOf(deal.closed)}  amoCRM ${deal.dealId}`,
    );
  }
  const lost = unknown.reduce((sum, deal) => sum + deal.amount, 0);
  console.log(`  Итого не привязано: ${lost.toLocaleString('ru-RU')} ₸`);
}

if (problems.length) {
  console.log('\nЧто не уехало:');
  for (const problem of problems.slice(0, 15)) console.log(`  ${problem}`);
  if (problems.length > 15) console.log(`  …и ещё ${problems.length - 15}`);
}
