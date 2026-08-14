import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { IconAds, IconChain, IconCreatives, IconReceipts } from '@/components/ui/icons';
import { requireFullAccess } from '@/lib/auth';
import { publicEnv } from '@/lib/env';
import { formatDateTime } from '@/lib/format';
import { INTEGRATION_STATUS, statusOf } from '@/lib/labels';
import { getIntegrations } from '@/lib/queries';

export const metadata: Metadata = { title: 'Интеграции' };

const CATALOG = [
  {
    platform: 'meta',
    title: 'Meta Ads',
    icon: IconAds,
    description:
      'Кампании, группы объявлений, объявления, креативы и дневная статистика расхода из Meta Marketing API.',
  },
  {
    platform: 'tiktok',
    title: 'TikTok Ads',
    icon: IconCreatives,
    description:
      'Расход, показы, клики и лиды из TikTok Ads API — в той же модели данных, что и Meta.',
  },
  {
    platform: 'telegram',
    title: 'Telegram-бот',
    icon: IconReceipts,
    description:
      'Приём чеков от менеджеров прямо в чат: сумма и телефон привязываются к продаже.',
  },
  {
    platform: 'crm',
    title: 'CRM и формы',
    icon: IconChain,
    description:
      'Приём лидов из внешних форм и CRM с сохранением UTM-меток и привязкой к креативу.',
  },
] as const;

export default async function IntegrationsPage() {
  const { company } = await requireFullAccess();
  const integrations = await getIntegrations(company.id);
  // Адрес берём из самого запроса: он верен и на боевом домене, и на превью,
  // и не зависит от того, что записано в переменных окружения.
  const host = (await headers()).get('host');
  const origin = host ? `https://${host}` : publicEnv.siteUrl;
  const webhookUrl = company.lead_webhook_key
    ? `${origin}/api/forms/${company.lead_webhook_key}`
    : 'Ключ ещё не выдан — обратитесь к администратору платформы';
  const byPlatform = new Map(integrations.map((item) => [item.platform, item]));

  return (
    <>
      <PageHeader
        title="Интеграции"
        description="Источники данных компании. Ключи и токены хранятся только на сервере и в браузер не передаются."
      />

      <PageBody>
        <div className="grid gap-4 lg:grid-cols-2">
          {CATALOG.map((item) => {
            const record = byPlatform.get(item.platform);
            const status = statusOf(INTEGRATION_STATUS, record?.status ?? 'disconnected');

            return (
              <Card key={item.platform} className="flex flex-col p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-panel border border-line bg-surface-2 text-lime">
                      <item.icon className="size-5" />
                    </span>
                    <div>
                      <h2 className="text-[15px] font-semibold text-ink">{item.title}</h2>
                      {record?.account_id ? (
                        <p className="mt-0.5 text-[12.5px] text-faint">{record.account_id}</p>
                      ) : null}
                    </div>
                  </div>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>

                <p className="mt-4 flex-1 text-[13.5px] leading-relaxed text-muted">
                  {item.description}
                </p>

                <div className="mt-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[12px] text-faint">
                      {record?.last_sync_at
                        ? `Обновлено: ${formatDateTime(record.last_sync_at)}`
                        : 'Синхронизаций ещё не было'}
                    </p>
                    {item.platform === 'meta' ? (
                      <ButtonLink href="/dashboard/ads" variant="secondary" size="sm">
                        Открыть «Рекламу»
                      </ButtonLink>
                    ) : null}
                  </div>

                  {syncError(record) ? (
                    <p className="rounded-control border border-negative/30 bg-negative/10 px-3 py-2 text-[12.5px] leading-relaxed text-negative">
                      Последняя попытка не удалась: {syncError(record)}
                    </p>
                  ) : null}

                  {item.platform === 'meta' ? (
                    <p className="text-[12px] text-faint">
                      Обновляется каждую ночь. Обновить вручную — кнопкой в разделе
                      «Реклама».
                    </p>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>

        <Card className="mt-4">
          <CardHeader
            title="Форма на сайте"
            subtitle="Заявки с лендинга попадают в «Лиды» вместе с меткой объявления"
          />
          <div className="space-y-4 px-5 py-5 sm:px-6">
            <div>
              <p className="text-[13px] font-medium text-ink-soft">Адрес приёма заявок</p>
              <code className="mt-2 block overflow-x-auto rounded-control border border-line bg-surface-2 px-3 py-2.5 text-[12.5px] text-ink">
                {webhookUrl}
              </code>
            </div>
            <ol className="space-y-3">
              {[
                'В Tilda: страница с формой → Настройки формы → «Webhook» → вставить этот адрес.',
                'В скрытые поля формы добавьте fbclid, utm_source, utm_medium, utm_campaign, utm_content — Tilda подставит их из адреса страницы.',
                'Отправьте тестовую заявку: человек появится в разделе «Лиды» с источником «сайт».',
              ].map((step, index) => (
                <li key={step} className="flex gap-3.5">
                  <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-[12px] font-medium text-lime">
                    {index + 1}
                  </span>
                  <p className="text-[13.5px] leading-relaxed text-ink-soft">{step}</p>
                </li>
              ))}
            </ol>
            <p className="text-[12px] leading-relaxed text-faint">
              Адрес — как ключ от почтового ящика: по нему можно только оставить заявку,
              прочитать данные компании нельзя. Публиковать его на видном месте всё же
              не стоит.
            </p>
          </div>
        </Card>

        <Card className="mt-4">
          <CardHeader
            title="Как обновляются данные"
            subtitle="Ручные выгрузки не нужны — цифры приходят из рекламного кабинета сами"
          />
          <ol className="space-y-4 px-5 py-5 sm:px-6">
            {[
              'Каждую ночь платформа сама забирает данные из рекламного кабинета.',
              'Забираются последние 30 дней: площадка ещё пару дней уточняет вчерашние цифры.',
              'Кампании, креативы, расход и результат обновляются одним заходом.',
              'Нужны свежие цифры прямо сейчас — кнопка «Обновить» в разделе «Реклама».',
            ].map((step, index) => (
              <li key={step} className="flex gap-3.5">
                <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-[12px] font-medium text-lime">
                  {index + 1}
                </span>
                <p className="text-[14px] leading-relaxed text-ink-soft">{step}</p>
              </li>
            ))}
          </ol>
        </Card>
      </PageBody>
    </>
  );
}

/** Текст ошибки последней синхронизации, если она была. */
function syncError(record: { config?: unknown } | undefined): string | null {
  if (!record || typeof record.config !== 'object' || record.config === null) return null;
  const value = (record.config as { error?: unknown }).error;
  return typeof value === 'string' && value ? value : null;
}
