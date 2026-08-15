'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import { CURRENCIES } from '@/lib/format';
import { FUNNEL_LABELS } from '@/lib/metrics';
import { updateCompany, type SettingsState } from './actions';

export function CompanyForm({
  defaults,
  disabled,
}: {
  defaults: {
    name: string;
    director_name: string;
    phone: string;
    funnel_type: string;
    currency: string;
    sales_currency: string;
  };
  disabled: boolean;
}) {
  const [state, formAction] = useActionState(updateCompany, {} as SettingsState);

  return (
    <form action={formAction} className="space-y-4 px-5 py-5 sm:px-6">
      <fieldset disabled={disabled} className="space-y-4">
        <Field label="Название компании" name="name" defaultValue={defaults.name} required />
        <Field
          label="Имя директора"
          name="director_name"
          defaultValue={defaults.director_name}
        />
        <Field label="Телефон" name="phone" type="tel" defaultValue={defaults.phone} />

        <div>
          <label htmlFor="currency" className="block text-[13px] font-medium text-ink-soft">
            Валюта рекламных отчётов
          </label>
          <select
            id="currency"
            name="currency"
            defaultValue={defaults.currency}
            className="mt-2 h-11 w-full rounded-control border border-line bg-surface-2 px-3 text-[14.5px] text-ink focus:border-lime/50 focus:outline-none"
          >
            {(Object.keys(CURRENCIES) as (keyof typeof CURRENCIES)[]).map((key) => (
              <option key={key} value={key}>
                {CURRENCIES[key].label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
            Крупная валюта в разделах «Реклама» и «Креативы»: расход, цена лида, CPC.
            Вторая валюта всегда подписана рядом мелким шрифтом, с курсом Нацбанка РК —
            видно и то и другое, переключаться не нужно.
          </p>
        </div>

        <div>
          <label
            htmlFor="sales_currency"
            className="block text-[13px] font-medium text-ink-soft"
          >
            Валюта продаж и чеков
          </label>
          <select
            id="sales_currency"
            name="sales_currency"
            defaultValue={defaults.sales_currency}
            className="mt-2 h-11 w-full rounded-control border border-line bg-surface-2 px-3 text-[14.5px] text-ink focus:border-lime/50 focus:outline-none"
          >
            {(Object.keys(CURRENCIES) as (keyof typeof CURRENCIES)[]).map((key) => (
              <option key={key} value={key}>
                {CURRENCIES[key].label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
            В ней приходят деньги: сумму продажи продажник присылает в бот просто числом
            и считается она этой валютой. Выручка, прибыль, средний чек и «Главная»
            всегда показываются в ней и никуда не пересчитываются.
          </p>
        </div>

        <div>
          <label
            htmlFor="funnel_type"
            className="block text-[13px] font-medium text-ink-soft"
          >
            Тип воронки
          </label>
          <select
            id="funnel_type"
            name="funnel_type"
            defaultValue={defaults.funnel_type}
            className="mt-2 h-11 w-full rounded-control border border-line bg-surface-2 px-3 text-[14.5px] text-ink focus:border-lime/50 focus:outline-none"
          >
            {(['trial', 'direct'] as const).map((key) => (
              <option key={key} value={key}>
                {FUNNEL_LABELS[key].title}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
            {FUNNEL_LABELS.direct.hint}. Без пробных занятий раздел «Пробные» скрывается,
            а промежуточным шагом воронки становится «взято в работу».
          </p>
        </div>
      </fieldset>

      <FormMessage error={state.error} success={state.success} />

      {disabled ? (
        <p className="text-[12.5px] text-faint">
          Редактирование доступно только директору компании.
        </p>
      ) : (
        <SubmitButton />
      )}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Сохраняем…' : 'Сохранить'}
    </Button>
  );
}
