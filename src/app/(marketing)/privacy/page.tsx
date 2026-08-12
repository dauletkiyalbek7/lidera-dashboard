import type { Metadata } from 'next';

import { SiteFooter } from '@/components/landing/site-footer';
import { SiteHeader } from '@/components/landing/site-header';
import { SectionTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Политика конфиденциальности',
  description: 'Как Lidera собирает, хранит и защищает данные клиентов платформы.',
  alternates: { canonical: '/privacy' },
};

const SECTIONS = [
  {
    title: '1. Какие данные мы обрабатываем',
    body: 'Lidera обрабатывает данные учётных записей (имя, email, телефон), данные подключённых компаний, а также рекламные и CRM-данные: кампании, креативы, лиды, пробные занятия, продажи и чеки. Платёжные реквизиты банковских карт платформа не хранит.',
  },
  {
    title: '2. Зачем мы их обрабатываем',
    body: 'Данные используются только для работы сервиса: расчёта показателей рекламы, построения сквозной аналитики, отображения отчётов и предоставления доступа сотрудникам компании.',
  },
  {
    title: '3. Изоляция данных компаний',
    body: 'Каждая компания — отдельный арендатор платформы. Изоляция обеспечивается политиками безопасности на уровне строк в базе данных (Row Level Security), а не только фильтрацией в интерфейсе. Пользователь одной компании технически не может получить данные другой.',
  },
  {
    title: '4. Доступ и хранение',
    body: 'Данные хранятся в управляемой базе PostgreSQL (Supabase). Доступ к служебным ключам есть только у серверной части приложения; в браузер они не передаются. Пароли хранятся в виде необратимых хэшей.',
  },
  {
    title: '5. Рекламные площадки',
    body: 'При подключении рекламных кабинетов Meta Ads и TikTok Ads платформа получает доступ к статистике кампаний в объёме, необходимом для аналитики. Токены доступа хранятся на сервере в зашифрованном виде и не передаются третьим лицам.',
  },
  {
    title: '6. Срок хранения и удаление',
    body: 'Данные хранятся, пока действует договор с компанией. По запросу владельца компании учётная запись деактивируется, а данные удаляются в разумный срок, за исключением сведений, которые мы обязаны хранить по закону.',
  },
  {
    title: '7. Контакты',
    body: 'Вопросы по обработке персональных данных: hello@lidera.kz.',
  },
];

export default function PrivacyPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-shell px-5 py-20 sm:px-8 lg:py-28">
          <SectionTitle
            eyebrow="Документы"
            title="Политика конфиденциальности"
            description="Редакция от 1 января 2026 года."
          />

          <div className="mt-12 max-w-3xl space-y-8">
            {SECTIONS.map((section) => (
              <section key={section.title}>
                <h2 className="text-[16px] font-semibold text-ink">{section.title}</h2>
                <p className="mt-3 text-[14.5px] leading-relaxed text-ink-soft">
                  {section.body}
                </p>
              </section>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
