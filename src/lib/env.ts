/**
 * Единая точка чтения переменных окружения.
 *
 * NEXT_PUBLIC_* попадают в клиентский бандл — там только публичные значения.
 * SUPABASE_SERVICE_ROLE_KEY читается исключительно через serverEnv(), который
 * никогда не должен импортироваться в клиентских компонентах.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Не задана переменная окружения ${name}. Скопируйте .env.example в .env.local и заполните значения.`,
    );
  }
  return value;
}

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lidera.kz',
};

export function requirePublicEnv() {
  return {
    supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL', publicEnv.supabaseUrl),
    supabaseAnonKey: required('NEXT_PUBLIC_SUPABASE_ANON_KEY', publicEnv.supabaseAnonKey),
  };
}

/** Только для серверного кода. Ключ даёт полный доступ к базе в обход RLS. */
export function serviceRoleKey(): string {
  return required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export const isSupabaseConfigured =
  Boolean(publicEnv.supabaseUrl) && Boolean(publicEnv.supabaseAnonKey);
