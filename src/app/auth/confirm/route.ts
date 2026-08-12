import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Обмен одноразового токена из письма (восстановление пароля, приглашение)
 * на серверную сессию. Токен приходит в ссылке и живёт минуты.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? '/dashboard';

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL('/login?error=invalid_link', origin));
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    return NextResponse.redirect(new URL('/forgot-password?expired=1', origin));
  }

  // Только внутренние пути — защита от открытого редиректа.
  const destination = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  return NextResponse.redirect(new URL(destination, origin));
}
