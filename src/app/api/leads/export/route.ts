import { NextResponse } from 'next/server';

import { requireCompanySession } from '@/lib/auth';
import { resolveRange, zonedDayWindow } from '@/lib/period';
import { creativeLabel } from '@/lib/creative-label';
import { leadStatusLabel } from '@/lib/lead-status';
import { PLATFORM_LABELS } from '@/lib/labels';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Выгрузка заявок за период.
 *
 * Списком на экране пользуются, чтобы смотреть; считать удобнее в таблице.
 * Отдаём тот же срез, что видит человек: период, отдел — всё из адреса.
 *
 * Читаем страницами и под своей учётной записью: правила доступа те же, что и
 * в кабинете, и директор чужой компании ничего отсюда не получит.
 */
export const dynamic = 'force-dynamic';

/** Сколько строк тянем за один запрос: PostgREST больше и не отдаст. */
const PAGE_SIZE = 1000;

/** Защита от бесконечного чтения, если ответ поведёт себя неожиданно. */
const MAX_ROWS = 100_000;

export async function GET(request: Request) {
  const { company } = await requireCompanySession();
  const supabase = await createServerSupabase();

  const url = new URL(request.url);
  const range = resolveRange(
    {
      period: url.searchParams.get('period') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    },
    company.timezone,
  );

  const day = zonedDayWindow(range.from, range.to, company.timezone);
  const departmentId = url.searchParams.get('department');

  const [{ data: creatives }, { data: departments }, { data: employees }] = await Promise.all([
    supabase
      .from('creatives')
      .select('id, name, label, format, created_at')
      .eq('company_id', company.id)
      .order('created_at')
      .order('id'),
    supabase.from('departments').select('id, name').eq('company_id', company.id),
    supabase.from('employees').select('id, full_name').eq('company_id', company.id),
  ]);

  const creativeNames = new Map(
    (creatives ?? []).map((row, index) => [row.id, creativeLabel(row, index + 1)]),
  );
  const departmentNames = new Map((departments ?? []).map((row) => [row.id, row.name]));
  const employeeNames = new Map((employees ?? []).map((row) => [row.id, row.full_name]));

  const rows: string[][] = [
    ['Имя', 'Телефон', 'Площадка', 'Отдел', 'Креатив', 'Статус', 'Ответственный', 'Получен'],
  ];

  for (let start = 0; start < MAX_ROWS; start += PAGE_SIZE) {
    let query = supabase
      .from('leads')
      .select(
        'name, phone, source, platform, status, created_at, creative_id, department_id, assigned_to',
      )
      .eq('company_id', company.id)
      .gte('created_at', day.startsAt)
      .lt('created_at', day.endsBefore)
      .order('created_at', { ascending: false })
      .range(start, start + PAGE_SIZE - 1);

    if (departmentId) query = query.eq('department_id', departmentId);

    const { data } = await query;

    for (const lead of data ?? []) {
      rows.push([
        lead.name ?? '',
        lead.phone ?? '',
        lead.platform ? (PLATFORM_LABELS[lead.platform] ?? lead.platform) : (lead.source ?? ''),
        lead.department_id ? (departmentNames.get(lead.department_id) ?? '') : '',
        lead.creative_id ? (creativeNames.get(lead.creative_id) ?? '') : '',
        leadStatusLabel(lead.status, company.trial_term),
        lead.assigned_to ? (employeeNames.get(lead.assigned_to) ?? '') : '',
        lead.created_at,
      ]);
    }

    if (!data || data.length < PAGE_SIZE) break;
  }

  const file = `leads-${range.from}-${range.to}.csv`;

  // Точка с запятой и метка кодировки — ради Excel: с запятой он сваливает
  // строку в одну ячейку, а без метки показывает кириллицу кракозябрами.
  const csv = `﻿${rows.map((row) => row.map(cell).join(';')).join('\r\n')}`;

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** Кавычки внутри значения удваиваются — иначе таблица разъезжается. */
function cell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
