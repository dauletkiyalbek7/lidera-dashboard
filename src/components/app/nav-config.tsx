'use client';

import type { FunnelType } from '@/lib/metrics';
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
  IconTrials,
} from '@/components/ui/icons';

export type NavItem = {
  href: string;
  label: string;
  icon: (props: React.SVGProps<SVGSVGElement>) => React.ReactElement;
  /** Раздел уже есть в интерфейсе, но наполняется на следующем этапе. */
  soon?: boolean;
  /** Раздел показывается только компаниям с такой воронкой. */
  onlyFunnel?: FunnelType;
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
    items: [{ href: '/dashboard', label: 'Dashboard', icon: IconDashboard }],
  },
  {
    title: 'Реклама',
    items: [
      { href: '/dashboard/ads', label: 'Реклама', icon: IconAds },
      { href: '/dashboard/creatives', label: 'Креативы', icon: IconCreatives },
    ],
  },
  {
    title: 'Продажи',
    items: [
      { href: '/dashboard/leads', label: 'Лиды', icon: IconLeads },
      { href: '/dashboard/trials', label: 'Пробные', icon: IconTrials, onlyFunnel: 'trial' },
      { href: '/dashboard/sales', label: 'Продажи', icon: IconSales },
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

/** Меню для конкретного рабочего пространства с учётом типа воронки. */
export function navFor(key: NavKey, funnelType: FunnelType): NavGroup[] {
  return NAV_BY_KEY[key]
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !item.onlyFunnel || item.onlyFunnel === funnelType,
      ),
    }))
    .filter((group) => group.items.length > 0);
}
