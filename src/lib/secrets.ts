import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Шифрование чужих токенов перед записью в базу.
 *
 * Токен рекламного кабинета — это право писать события от имени клиента,
 * поэтому в базе он лежит зашифрованным: даже выгрузка таблицы ничего не даёт.
 *
 * Ключ берём из LIDERA_SECRETS_KEY, а если его нет — выводим из сервисного
 * ключа Supabase. Это не «ключ под ковриком»: сервисный ключ и так открывает
 * всю базу, так что отдельной дырой производный ключ не становится. Но помните:
 * смена сервисного ключа без заранее заданного LIDERA_SECRETS_KEY сделает
 * сохранённые токены нечитаемыми — их придётся ввести заново.
 */

const ALGORITHM = 'aes-256-gcm';
const SALT = 'lidera.secrets.v1';

function encryptionKey(): Buffer {
  const explicit = process.env.LIDERA_SECRETS_KEY;
  const source = explicit || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!source) {
    throw new Error(
      'Нечем шифровать секреты: задайте LIDERA_SECRETS_KEY или SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  return scryptSync(source, SALT, 32);
}

/** Строка вида <iv>.<тег>.<шифртекст>, всё в base64url. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptSecret(payload: string): string {
  const [ivPart, tagPart, dataPart] = payload.split('.');
  if (!ivPart || !tagPart || !dataPart) throw new Error('Повреждённый секрет.');

  const decipher = createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Хвост токена для показа в интерфейсе: «…GhX2» вместо самого токена. */
export function secretHint(plain: string): string {
  return `…${plain.slice(-4)}`;
}
