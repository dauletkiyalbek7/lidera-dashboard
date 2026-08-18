'use client';

import type { FunnelType } from '@/lib/metrics';
import { trialWords } from '@/lib/trial-term';
import {
  IconAds,
  IconCompanies,
  IconCreatives,
  IconDashboard,
  IconFinance,
  IconIntegrations,
  IconLeads,
  IconReceipts,
  IconSales,
  IconSettings,
  IconAttendance,
  IconTeam,
  IconTrials,
} from '@/components/ui/icons';

export type NavItem = {
  href: string;
  label: string;
  icon: (props: React.SVGProps<SVGSVGElement>) => React.ReactElement;
  /** Раздел ещё наполняется: в меню его не показываем, по адресу он открыт. */
  soon?: boolean;
  /** Раздел показывается только компаниям с такой воронкой. */
  onlyFunnel?: FunnelType;
  /** Раздел виден рядовому сотруднику, а не только руководству. */
  staff?: true;
  /** Раздел нужен только сотруднику: у руководителя для этого есть настройки. */
  onlyStaff?: true;
  /** Сотруднику раздел открыт только с этой ролью. Руководства не касается. */
  onlyRole?: string;
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export type NavKey = 'company' | 'admin';

/** Меню кабинета компании. */
const COMPANY_NAV: NavGroup[] = [
  {
    title: 'Обзор',
    items: [{ href: '/dashboard', label: 'Главная', icon: IconDashboard }],
  },
  {
    title: 'Реклама',
    items: [
      {
        href: '/dashboard/ads',
        label: 'Реклама',
        icon: IconAds,
        staff: true,
        onlyRole: 'targetolog',
      },
      {
        href: '/dashboard/creatives',
        label: 'Креативы',
        icon: IconCreatives,
        staff: true,
        onlyRole: 'targetolog',
      },
      {
        href: '/dashboard/capi',
        label: 'CAPI',
        icon: IconIntegrations,
        staff: true,
        onlyRole: 'targetolog',
      },
    ],
  },
  {
    title: 'Продажи',
    items: [
      { href: '/dashboard/leads', label: 'Лиды', icon: IconLeads, staff: true },
      {
        href: '/dashboard/trials',
        label: 'Пробные уроки',
        icon: IconTrials,
        onlyFunnel: 'trial',
        staff: true,
      },
      { href: '/dashboard/sales', label: 'Продажи', icon: IconSales },
      { href: '/dashboard/returns', label: 'Возвраты', icon: IconReceipts },
      { href: '/dashboard/team', label: 'Команда', icon: IconTeam },
      { href: '/dashboard/attendance', label: 'Посещение', icon: IconAttendance },
    ],
  },
  {
    title: 'Финансы',
    items: [
      { href: '/dashboard/finance', label: 'Финансы', icon: IconFinance },
      { href: '/dashboard/receipts', label: 'Чеки', icon: IconReceipts, soon: true },
    ],
  },
  {
    title: 'Система',
    items: [
      { href: '/dashboard/integrations', label: 'Интеграции', icon: IconIntegrations },
      { href: '/dashboard/settings', label: 'Настройки', icon: IconSettings },
      // Рабочее место сотрудника: подключить Telegram и сменить свой пароль.
      // Директору не нужно — у него для этого «Настройки» и «Команда».
      {
        href: '/dashboard/me',
        label: 'Мой профиль',
        icon: IconTeam,
        staff: true,
        onlyStaff: true,
      },
    ],
  },
];

/** Меню платформенного администратора. */
const ADMIN_NAV: NavGroup[] = [
  {
    title: 'Платформа',
    items: [
      { href: '/admin', label: 'Компании', icon: IconCompanies },
      { href: '/admin/activity', label: 'Журнал действий', icon: IconReceipts },
    ],
  },
];

/**
 * Меню выбирается по ключу внутри клиентского компонента: сами пункты содержат
 * иконки-компоненты, а функции нельзя передать из серверного компонента в
 * клиентский через props.
 */
const NAV_BY_KEY: Record<NavKey, NavGroup[]> = {
  company: COMPANY_NAV,
  admin: ADMIN_NAV,
};

/**
 * Меню рабочего пространства с учётом воронки и роли.
 *
 * Рядовому сотруднику показываем только его рабочие разделы. Это удобство, а
 * не защита: чужие заявки ему не отдаст сама база, даже если он наберёт адрес
 * раздела руками.
 */
export function navFor(
  key: NavKey,
  funnelType: FunnelType,
  staffOnly = false,
  staffRole: string | null = null,
  trialTerm: string = 'trial',
): NavGroup[] {
  const middleSection = trialWords(trialTerm).section;

  return NAV_BY_KEY[key]
    .map((group) => ({
      ...group,
      // Раздел промежуточного шага компания зовёт по-своему: «Пробные уроки»
      // у школы, «Вебинары» у Дарына. Остальные названия у всех одинаковые.
      items: group.items
        .map((item) =>
          item.href === '/dashboard/trials' ? { ...item, label: middleSection } : item,
        )
        .filter(
        (item) =>
          !item.soon &&
          (!item.onlyFunnel || item.onlyFunnel === funnelType) &&
          (!staffOnly || item.staff === true) &&
          (staffOnly || !item.onlyStaff) &&
          // Реклама, креативы и CAPI — работа таргетолога. Менеджеру бюджет ни
          // к чему, да и база ему этих строк всё равно не отдаст.
          !(staffOnly && item.onlyRole && item.onlyRole !== staffRole),
      ),
    }))
    .filter((group) => group.items.length > 0);
}
