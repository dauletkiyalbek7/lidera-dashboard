import type { Metadata } from 'next';

import { DashboardMockup } from '@/components/landing/dashboard-mockup';
import { SiteFooter } from '@/components/landing/site-footer';
import { SiteHeader } from '@/components/landing/site-header';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { SectionTitle } from '@/components/ui/card';
import {
  IconAds,
  IconArrowRight,
  IconChain,
  IconCheck,
  IconCreatives,
  IconFinance,
  IconSales,
} from '@/components/ui/icons';
import { formatMoney, formatNumber, formatRatio } from '@/lib/format';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

const FEATURES = [
  {
    icon: IconAds,
    title: 'Аналитика рекламы',
    description:
      'Meta Ads и TikTok Ads в одном окне: кампании, группы, объявления, бюджеты и расход по дням.',
  },
  {
    icon: IconCreatives,
    title: 'Аналитика креативов',
    description:
      'Определяйте лучшие и худшие креативы — по выручке, а не по количеству лидов.',
  },
  {
    icon: IconChain,
    title: 'Сквозная аналитика',
    description:
      'Связывайте рекламу с продажами: каждый лид помнит кампанию, объявление и креатив.',
  },
  {
    icon: IconFinance,
    title: 'Финансовая аналитика',
    description: 'Расходы, CPL, CAC, ROAS, ROI и выручка считаются автоматически.',
  },
  {
    icon: IconSales,
    title: 'Контроль продаж',
    description:
      'Понимайте, сколько лидов дошли до пробного, а сколько реально стали клиентами.',
  },
];

const EXAMPLE_ROWS = [
  {
    creative: 'Video 01',
    spend: 100_000,
    leads: 200,
    cpl: 500,
    sales: 15,
    revenue: 750_000,
    roas: 7.5,
  },
  {
    creative: 'Video 02',
    spend: 150_000,
    leads: 400,
    cpl: 375,
    sales: 3,
    revenue: 150_000,
    roas: 1.0,
  },
];

const STEPS = [
  {
    title: 'Подключите рекламные кабинеты',
    description: 'Meta Ads и TikTok Ads — кампании, объявления и креативы подтянутся сами.',
  },
  {
    title: 'Получайте данные о лидах',
    description: 'Каждый лид сохраняет источник, кампанию, объявление, креатив и UTM-метки.',
  },
  {
    title: 'Связывайте лиды с продажами',
    description: 'Пробные, продажи и чеки закрывают цепочку до реальных денег.',
  },
  {
    title: 'Анализируйте эффективность',
    description: 'Смотрите CPL, CAC, ROAS и ROI в разрезе каждого креатива.',
  },
];

const AUDIENCE = [
  'Владельцы бизнеса',
  'Таргетологи',
  'Маркетологи',
  'Онлайн-школы',
  'E-commerce',
  'Сервисные компании',
  'Образовательные проекты',
];

const CHAIN = ['Реклама', 'Лид', 'Пробный', 'Продажа', 'Выручка'];

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* ---------------------------------------------------------------- Hero */}
        <section className="relative overflow-hidden">
          <div className="glow-lime pointer-events-none absolute inset-x-0 top-0 h-[560px]" />
          <div className="grid-bg pointer-events-none absolute inset-0" />

          <div className="relative mx-auto max-w-shell px-5 pb-16 pt-16 sm:px-8 sm:pt-24 lg:pb-24">
            <div className="mx-auto max-w-3xl text-center">
              <Badge tone="lime" className="mx-auto">
                Meta Ads · TikTok Ads · CRM
              </Badge>
              <h1 className="mt-6 text-balance text-[42px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-6xl lg:text-[68px]">
                Сквозная аналитика рекламы до&nbsp;реальной продажи
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-pretty text-[16px] leading-relaxed text-ink-soft sm:text-lg">
                Узнайте, какой креатив приносит не просто лиды, а реальные продажи и
                выручку.
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <ButtonLink href="/login" size="lg" className="w-full sm:w-auto">
                  Попробовать Lidera
                  <IconArrowRight className="size-4" />
                </ButtonLink>
                <ButtonLink
                  href="/#example"
                  variant="secondary"
                  size="lg"
                  className="w-full sm:w-auto"
                >
                  Получить доступ
                </ButtonLink>
              </div>
            </div>

            <div className="mx-auto mt-14 max-w-5xl animate-rise sm:mt-20">
              <DashboardMockup />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------- Проблема */}
        <section className="border-t border-line bg-surface/40">
          <div className="mx-auto max-w-shell px-5 py-20 sm:px-8 lg:py-28">
            <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
              <SectionTitle
                eyebrow="Проблема"
                title="Рекламный кабинет не знает, сколько вы заработали"
                description="Большинство рекламных кабинетов показывают только то, что происходит до заявки. Дальше начинается слепая зона."
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-card border border-line bg-surface p-6">
                  <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-faint">
                    Кабинет показывает
                  </p>
                  <ul className="mt-4 space-y-2.5 text-[14.5px] text-ink-soft">
                    {['Расходы', 'Клики', 'CTR', 'Лиды', 'CPL'].map((item) => (
                      <li key={item} className="flex items-center gap-2.5">
                        <span className="size-1.5 rounded-full bg-line-strong" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-card border border-lime/30 bg-lime/[0.06] p-6">
                  <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-lime">
                    Бизнесу нужно знать
                  </p>
                  <p className="mt-4 text-balance text-[19px] font-semibold leading-snug text-ink">
                    Сколько денег реально принёс каждый креатив
                  </p>
                  <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">
                    Не заявки. Не показы. Деньги на счёте — и креатив, который их принёс.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------- Решение */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-shell px-5 py-20 sm:px-8 lg:py-28">
            <SectionTitle
              eyebrow="Решение"
              title="Lidera соединяет всю цепочку в одну"
              description="От первого показа объявления до денег в кассе — одна связанная цепочка, а не пять разных таблиц."
              className="mx-auto text-center"
            />

            <ol className="mt-14 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
              {CHAIN.map((step, index) => (
                <li key={step} className="flex items-center gap-3 sm:gap-4">
                  <span
                    className={`rounded-panel border px-4 py-3 text-[14px] font-medium sm:px-6 sm:py-4 sm:text-[15px] ${
                      index === CHAIN.length - 1
                        ? 'border-lime/40 bg-lime/10 text-lime'
                        : 'border-line bg-surface text-ink'
                    }`}
                  >
                    {step}
                  </span>
                  {index < CHAIN.length - 1 ? (
                    <IconArrowRight className="size-4 shrink-0 text-faint" />
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------------------------------------------------------- Возможности */}
        <section id="features" className="scroll-mt-20 border-t border-line bg-surface/40">
          <div className="mx-auto max-w-shell px-5 py-20 sm:px-8 lg:py-28">
            <SectionTitle
              eyebrow="Возможности"
              title="Всё, что нужно, чтобы управлять рекламой по деньгам"
            />

            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, description }) => (
                <article
                  key={title}
                  className="group rounded-card border border-line bg-surface p-6 transition-colors hover:border-line-strong"
                >
                  <div className="flex size-11 items-center justify-center rounded-panel border border-line bg-surface-2 text-lime">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="mt-5 text-[16px] font-semibold text-ink">{title}</h3>
                  <p className="mt-2.5 text-[14px] leading-relaxed text-muted">
                    {description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ Пример аналитики */}
        <section id="example" className="scroll-mt-20 border-t border-line">
          <div className="mx-auto max-w-shell px-5 py-20 sm:px-8 lg:py-28">
            <SectionTitle
              eyebrow="Пример аналитики"
              title="Два креатива. Один выглядит лучше — зарабатывает другой"
              description="Video 02 даёт вдвое больше лидов и заметно дешевле. Но деньги приносит Video 01."
            />

            <div className="mt-10 overflow-hidden rounded-card border border-line bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-[14px]">
                  <caption className="sr-only">
                    Сравнение двух креативов по расходу, лидам, CPL, продажам, выручке и ROAS
                  </caption>
                  <thead className="border-b border-line bg-surface-2 text-[13px] text-muted">
                    <tr>
                      <th scope="col" className="px-5 py-3.5 font-medium">Креатив</th>
                      <th scope="col" className="px-5 py-3.5 text-right font-medium">Расход</th>
                      <th scope="col" className="px-5 py-3.5 text-right font-medium">Лиды</th>
                      <th scope="col" className="px-5 py-3.5 text-right font-medium">CPL</th>
                      <th scope="col" className="px-5 py-3.5 text-right font-medium">Продажи</th>
                      <th scope="col" className="px-5 py-3.5 text-right font-medium">Выручка</th>
                      <th scope="col" className="px-5 py-3.5 text-right font-medium">ROAS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {EXAMPLE_ROWS.map((row) => (
                      <tr key={row.creative}>
                        <th scope="row" className="px-5 py-4 text-left font-medium text-ink">
                          {row.creative}
                        </th>
                        <td className="tabular px-5 py-4 text-right text-ink-soft">
                          {formatMoney(row.spend)}
                        </td>
                        <td className="tabular px-5 py-4 text-right text-ink-soft">
                          {formatNumber(row.leads)}
                        </td>
                        <td className="tabular px-5 py-4 text-right text-ink-soft">
                          {formatMoney(row.cpl)}
                        </td>
                        <td className="tabular px-5 py-4 text-right text-ink-soft">
                          {formatNumber(row.sales)}
                        </td>
                        <td className="tabular px-5 py-4 text-right text-ink">
                          {formatMoney(row.revenue)}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <Badge tone={row.roas >= 2 ? 'positive' : 'negative'}>
                            <span className="tabular">{formatRatio(row.roas)}</span>
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-line bg-lime/[0.05] px-5 py-6 sm:px-8">
                <p className="text-balance text-[19px] font-semibold text-ink sm:text-[22px]">
                  Дешёвый лид ≠ хорошая реклама.
                </p>
                <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-soft">
                  Video 02 приносит лид за 375 ₸ вместо 500 ₸ — и при этом сжигает бюджет.
                  Без связи с продажами вы бы масштабировали именно его.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- Как работает */}
        <section id="how" className="scroll-mt-20 border-t border-line bg-surface/40">
          <div className="mx-auto max-w-shell px-5 py-20 sm:px-8 lg:py-28">
            <SectionTitle eyebrow="Как работает" title="Четыре шага до понятной картины" />

            <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="rounded-card border border-line bg-surface p-6"
                >
                  <span className="tabular inline-flex size-8 items-center justify-center rounded-full border border-lime/30 bg-lime/10 text-[13px] font-semibold text-lime">
                    {index + 1}
                  </span>
                  <h3 className="mt-5 text-[15.5px] font-semibold leading-snug text-ink">
                    {step.title}
                  </h3>
                  <p className="mt-2.5 text-[14px] leading-relaxed text-muted">
                    {step.description}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* --------------------------------------------------------------- Для кого */}
        <section id="audience" className="scroll-mt-20 border-t border-line">
          <div className="mx-auto max-w-shell px-5 py-20 sm:px-8 lg:py-28">
            <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
              <SectionTitle
                eyebrow="Для кого"
                title="Для тех, кто платит за рекламу из своего кармана"
                description="Если реклама — статья расходов, а не эксперимент, вам нужны деньги в отчёте, а не клики."
              />
              <ul className="grid gap-3 self-center sm:grid-cols-2">
                {AUDIENCE.map((item) => (
                  <li
                    key={item}
                    className="flex items-center gap-3 rounded-panel border border-line bg-surface px-4 py-3.5 text-[14.5px] text-ink"
                  >
                    <IconCheck className="size-4 shrink-0 text-lime" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------------- CTA */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-shell px-5 py-20 sm:px-8 lg:py-28">
            <div className="glow-lime relative overflow-hidden rounded-card border border-line bg-surface px-6 py-16 text-center sm:px-12">
              <h2 className="mx-auto max-w-2xl text-balance text-3xl font-semibold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[40px]">
                Перестаньте смотреть только на количество лидов
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-pretty text-[16px] leading-relaxed text-ink-soft">
                Смотрите, какая реклама реально приносит деньги.
              </p>
              <ButtonLink href="/login" size="lg" className="mt-9">
                Начать работу с Lidera
                <IconArrowRight className="size-4" />
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
