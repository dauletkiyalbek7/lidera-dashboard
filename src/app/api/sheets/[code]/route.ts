import { NextResponse } from 'next/server';

import { buildReportSheet, isSheetKeyValid, toCsv, type SheetView } from '@/lib/report-sheet';

/**
 * Сводный отчёт для Google Таблицы: CSV по секретной ссылке.
 *
 * В ячейке таблицы стоит формула вида
 *   =IMPORTDATA("https://…/api/sheets/<код>?key=…&from=2026-10-01"; ","; "en_US")
 * и Google сам перечитывает её примерно раз в час. Вход в платформу здесь не
 * нужен: доступ даёт подпись в ссылке, и открывает она только проекты этого
 * кода (см. report-sheet.ts).
 *
 * view=days — день × проект, view=campaigns — день × кампания.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const url = new URL(request.url);

  if (!UUID.test(code) || !isSheetKeyValid(code, url.searchParams.get('key'))) {
    return NextResponse.json({ error: 'ссылка неверна' }, { status: 404 });
  }

  const view: SheetView = url.searchParams.get('view') === 'campaigns' ? 'campaigns' : 'days';
  const rows = await buildReportSheet(code, view, url.searchParams.get('from'));

  if (!rows) return NextResponse.json({ error: 'у кода нет проектов' }, { status: 404 });

  return new NextResponse(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
