import type { Metadata } from 'next';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { requireAdsAccess } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { TikTokSettingsForm } from './settings-form';

/**
 * Подключение TikTok Ads.
 *
 * Отдельной страницей, а не полем в общем списке интеграций: здесь вводят
 * токен, и такой странице нужно место под объяснение, где его взять, — иначе
 * ключи вводят наугад и потом ищут, почему кабинет молчит.
 */

export const metadata: Metadata = { title: 'TikTok Ads' };

export default async function TikTokIntegrationPage() {
  const { company } = await requireAdsAccess();
  const supabase = createAdminSupabase();

  const [{ data: integration }, { data: account }] = await Promise.all([
    supabase
      .from('integrations')
      .select('config, status, last_sync_at, account_id')
      .eq('company_id', company.id)
      .eq('platform', 'tiktok')
      .maybeSingle(),
    supabase
      .from('ad_accounts')
      .select('account_id, account_name, currency, status')
      .eq('company_id', company.id)
      .eq('platform', 'tiktok')
      .maybeSingle(),
  ]);

  const config = (integration?.config ?? null) as { token_encrypted?: string } | null;
  const hasToken = Boolean(config?.token_encrypted);

  return (
    <>
      <PageHeader
        title="TikTok Ads"
        description="Кампании, объявления, ролики и дневной расход — той же моделью, что и Meta."
      />

      <PageBody>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <CardHeader
              title="Подключение кабинета"
              subtitle="Ключи хранятся на сервере в зашифрованном виде и в браузер не передаются."
              action={
                hasToken ? (
                  <Badge tone={integration?.status === 'error' ? 'negative' : 'positive'}>
                    {integration?.status === 'error' ? 'Ошибка' : 'Подключено'}
                  </Badge>
                ) : (
                  <Badge tone="neutral">Не подключено</Badge>
                )
              }
            />

            <TikTokSettingsForm
              advertiserId={account?.account_id ?? integration?.account_id ?? ''}
              accountName={account?.account_name ?? ''}
              currency={account?.currency ?? 'KZT'}
              hasToken={hasToken}
            />
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader title="Где взять ключи" />
              <ol className="space-y-3 p-5 text-[13px] text-ink-soft sm:p-6">
                <li>
                  <b className="text-ink">Номер кабинета.</b> TikTok Ads Manager, раздел
                  «Настройки аккаунта». Длинное число, без дефисов.
                </li>
                <li>
                  <b className="text-ink">Токен.</b> business-api.tiktok.com — создать
                  приложение, выдать ему доступ к вашему Business Center и авторизовать
                  кабинет. В ответ приходит Access Token.
                </li>
                <li>
                  <b className="text-ink">Права.</b> Достаточно чтения отчётов и списка
                  кампаний. Право менять рекламу платформе не нужно — не выдавайте его.
                </li>
              </ol>
            </Card>

            <Card>
              <CardHeader title="Как это работает" />
              <div className="space-y-3 p-5 text-[13px] text-ink-soft sm:p-6">
                <p>
                  Каждые два часа платформа забирает кампании, объявления и расход по
                  дням. Раз в сутки — глубже, за тридцать дней: кабинет уточняет
                  вчерашние цифры ещё пару дней после закрытия суток.
                </p>
                <p>
                  Расход хранится в валюте кабинета, а в отчёт попадает в валюте проекта
                  — по курсу того дня, когда деньги были потрачены.
                </p>
                {integration?.last_sync_at ? (
                  <p className="text-ink">
                    Последняя загрузка:{' '}
                    {formatDateTime(integration.last_sync_at, company.timezone)}
                  </p>
                ) : null}
              </div>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}
