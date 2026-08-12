import { NextResponse, type NextRequest } from 'next/server';

import { createServerSupabase } from '@/lib/supabase/server';

/** Выход. Только POST — чтобы ссылка со стороннего сайта не разлогинивала. */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', request.nextUrl.origin), {
    status: 303,
  });
}
