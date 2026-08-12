'use client';

import { createBrowserClient } from '@supabase/ssr';

import { requirePublicEnv } from '@/lib/env';
import type { Database } from './database.types';

/** Supabase-клиент для браузера. Работает только с anon-ключом и под RLS. */
export function createClient() {
  const { supabaseUrl, supabaseAnonKey } = requirePublicEnv();
  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}
