import 'server-only';

import { createClient } from '@supabase/supabase-js';

import { requirePublicEnv, serviceRoleKey } from '@/lib/env';
import type { Database } from './database.types';

/**
 * Административный клиент: обходит RLS и умеет управлять Auth-пользователями.
 *
 * Использовать ТОЛЬКО в серверных действиях платформенного администратора
 * (создание компании и директора). Импорт 'server-only' гарантирует, что файл
 * никогда не попадёт в клиентский бандл. Каждый вызов обязан сам проверить,
 * что текущий пользователь — SUPER_ADMIN (см. requireSuperAdmin).
 */
export function createAdminSupabase() {
  const { supabaseUrl } = requirePublicEnv();

  return createClient<Database>(supabaseUrl, serviceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
