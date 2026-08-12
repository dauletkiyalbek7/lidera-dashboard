import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

import { requirePublicEnv } from '@/lib/env';
import type { Database } from './database.types';

/**
 * Supabase-клиент для Server Components, Server Actions и Route Handlers.
 * Сессия живёт в httpOnly-cookie; запросы идут от имени пользователя,
 * поэтому RLS остаётся в силе.
 */
export async function createServerSupabase() {
  const { supabaseUrl, supabaseAnonKey } = requirePublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Вызов из Server Component: запись cookie недоступна.
          // Обновление сессии берёт на себя middleware.
        }
      },
    },
  });
}
