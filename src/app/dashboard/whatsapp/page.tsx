import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconChain } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { requireFullAccess } from '@/lib/auth';
import { publicEnv } from '@/lib/env';
import { formatDateTime, formatNumber } from '@/lib/format';
import { getWhatsappOverview } from '@/lib/whatsapp-queries';
import { NumberForm } from './number-form';
import { NumberSwitch } from './number-switch';

/**
 * Раздел «WhatsApp» — номера, на которые пишут клиенты.
 *
 * Реклама, ведущая в переписки, до сих пор давала одну цифру: «начато N
 * переписок». Здесь подключается номер, после чего каждая переписка
 * становится обычной заявкой — с номером человека, его вопросом и
 * объявлением, которое его привело.
 */

export const metadata: Metadata = { title: 'WhatsApp' };

export default async function WhatsappPage() {
  const { company } = await requireFullAccess();
  const { numbers, departments, stats } = await getWhatsappOverview(company.id);

  // Адрес берём из самого запроса: он верен и на боевом домене, и на превью.
  const host = (await headers()).get('host');
  const origin = host ? `https://${host}` : publicEnv.siteUrl;

  return (
    <>
      <PageHeader
        title="WhatsApp"
        description="Переписки с рекламы становятся заявками: номер, вопрос клиента и объявление, которое его привело."
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Номеров подключено" value={formatNumber(stats.connected)} />
          <StatTile
            label="Клиентов написало"
            value={formatNumber(stats.leads)}
            hint="Всего людей за всё время"
          />
          <StatTile
            label="Сообщений принято"
            value={formatNumber(stats.inbound)}
            hint={stats.outbound ? `${formatNumber(stats.outbound)} автоответов` : undefined}
          />
          <StatTile
            label="Пришли с рекламы"
            value={formatNumber(stats.withClick)}
            hint="У этих переписок есть метка клика — их покупки дойдут до Meta"
            accent
          />
        </div>

        {numbers.length === 0 ? (
          <Card className="mt-4">
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={<IconChain className="size-5" />}
                title="Номер ещё не подключён"
                description="Заполните форму ниже, а адрес приёма и проверочную строку вставьте в настройки вебхука своего приложения Meta."
              />
            </div>
          </Card>
        ) : (
          <Card className="mt-4">
            <CardHeader
              title="Подключённые номера"
              subtitle="Адрес приёма и проверочная строка вставляются в настройки вебхука приложения Meta"
            />
            <div className="divide-y divide-line">
              {numbers.map((number) => (
                <div key={number.id} className="px-5 py-5 sm:px-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-ink">{number.label}</p>
                      <p className="tabular mt-0.5 text-[13.5px] text-muted">
                        {number.displayPhone ?? number.phoneNumberId}
                      </p>
                      <p className="mt-1 flex flex-wrap gap-x-3 text-[12.5px] text-faint">
                        {number.departmentName ? (
                          <span>Отдел: {number.departmentName}</span>
                        ) : null}
                        {number.lastMessageAt ? (
                          <span>Последнее сообщение: {formatDateTime(number.lastMessageAt)}</span>
                        ) : (
                          <span>Сообщений пока не было</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <Badge tone={number.status === 'connected' ? 'positive' : 'neutral'}>
                        {number.status === 'connected' ? 'Принимает' : 'Отключён'}
                      </Badge>
                      <NumberSwitch numberId={number.id} status={number.status} />
                    </div>
                  </div>

                  {number.lastError ? (
                    <p className="mt-3 rounded-control border border-negative/30 bg-negative/10 px-3 py-2 text-[12.5px] leading-relaxed text-negative">
                      {number.lastError}
                    </p>
                  ) : null}

                  {!number.hasAppSecret ? (
                    <p className="mt-3 rounded-control border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] leading-relaxed text-warning">
                      Секрет приложения не задан — подпись Meta проверить нечем, и
                      сообщения приниматься не будут. Это защита: без проверки
                      подписи заявку сюда может подбросить кто угодно.
                    </p>
                  ) : null}

                  <dl className="mt-4 space-y-3">
                    <div>
                      <dt className="text-[12px] text-faint">Адрес приёма (Callback URL)</dt>
                      <dd>
                        <code className="mt-1.5 block overflow-x-auto rounded-control border border-line bg-surface-2 px-3 py-2.5 text-[12.5px] text-ink">
                          {`${origin}/api/whatsapp/${number.webhookKey}`}
                        </code>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-faint">Проверочная строка (Verify Token)</dt>
                      <dd>
                        <code className="mt-1.5 block overflow-x-auto rounded-control border border-line bg-surface-2 px-3 py-2.5 text-[12.5px] text-ink">
                          {number.verifyToken}
                        </code>
                      </dd>
                    </div>
                  </dl>

                  <details className="mt-4">
                    <summary className="cursor-pointer text-[13px] text-muted transition-colors hover:text-ink">
                      Изменить настройки номера
                    </summary>
                    <div className="mt-2 rounded-panel border border-line">
                      <NumberForm defaults={number} departments={departments} />
                    </div>
                  </details>

                  {/* Подсказка следующего шага внизу карточки. Переключатель есть
                      и в шапке, но с раскрытой формой она уезжает за экран, и
                      человек, только что вписавший секрет, кнопки не находит. */}
                  {number.status !== 'connected' ? (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-surface-2 px-4 py-3">
                      <p className="text-[13px] text-ink-soft">
                        {number.hasAppSecret
                          ? 'Секрет задан. Осталось включить приём.'
                          : 'Впишите секрет приложения выше, затем включите приём.'}
                      </p>
                      <NumberSwitch numberId={number.id} status={number.status} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="mt-4">
          <CardHeader
            title={numbers.length === 0 ? 'Подключить номер' : 'Подключить ещё один номер'}
            subtitle="Токен и секрет приложения шифруются на сервере и в браузер не возвращаются"
          />
          <NumberForm departments={departments} />
        </Card>

        <Card className="mt-4">
          <CardHeader
            title="Как подключить"
            subtitle="Порядок действий в Meta for Developers"
          />
          <ol className="space-y-3 px-5 py-5 sm:px-6">
            {[
              'Номер должен быть выделенным: подключённый к Cloud API номер перестаёт работать в обычном приложении WhatsApp.',
              'В приложении Meta откройте WhatsApp → API Setup и скопируйте «Phone number ID» и «WhatsApp Business Account ID».',
              'Создайте постоянный токен системного пользователя с правами whatsapp_business_messaging и whatsapp_business_management.',
              'Секрет приложения возьмите в «Настройки → Основное → App Secret». Без него подпись не проверить.',
              'Заполните форму выше и сохраните — появятся адрес приёма и проверочная строка.',
              'В приложении Meta: WhatsApp → Configuration → Webhook. Вставьте адрес и проверочную строку, подпишитесь на поле messages.',
              'Напишите на номер с личного телефона: клиент появится в разделе «Лиды» с источником WhatsApp.',
            ].map((step, index) => (
              <li key={step} className="flex gap-3.5">
                <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-[12px] font-medium text-lime">
                  {index + 1}
                </span>
                <p className="text-[13.5px] leading-relaxed text-ink-soft">{step}</p>
              </li>
            ))}
          </ol>
          <p className="px-5 pb-5 text-[12px] leading-relaxed text-faint sm:px-6">
            Отвечать клиенту из платформы нельзя — переписку менеджеры ведут у себя.
            Отсюда уходит только автоответ, и только в первые 24 часа после
            сообщения клиента: дальше WhatsApp разрешает писать лишь согласованными
            с Meta шаблонами.
          </p>
        </Card>
      </PageBody>
    </>
  );
}
