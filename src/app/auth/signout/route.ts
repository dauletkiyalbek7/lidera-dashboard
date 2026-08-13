import { NextResponse, type NextRequest } from 'next/server';

import { VIEW_COMPANY_COOKIE } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

/** Выход. Только POST — чтобы ссылка со стороннего сайта не разлогинивала. */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();

  const response = NextResponse.redirect(new URL('/login', request.nextUrl.origin), {
    status: 303,
  });
  // Следующий вход в этом браузере не должен попадать в чужой кабинет.
  response.cookies.delete(VIEW_COMPANY_COOKIE);
  return response;
}
