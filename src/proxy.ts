import type { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/session';

/**
 * Next.js 16 называет этот слой proxy (ранее — middleware).
 * Здесь обновляется сессия Supabase и закрывается доступ анонимам.
 */
export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Все маршруты, кроме статики и файлов с расширением:
     * сессия должна обновляться и на публичных страницах.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)',
  ],
};
