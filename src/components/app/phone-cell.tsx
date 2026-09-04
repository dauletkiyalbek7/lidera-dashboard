import { IconWhatsapp } from '@/components/ui/icons';

/**
 * Номер клиента — сразу ссылкой в переписку.
 *
 * Половина людей не берёт трубку с незнакомого номера, но отвечает в
 * WhatsApp. Без ссылки менеджер копировал номер руками и искал его в
 * приложении — на два десятка заявок это отдельная работа. wa.me открывает
 * чат, даже если человека нет в контактах; номер идёт одними цифрами, скобки
 * и дефисы ссылка не понимает.
 */
export function PhoneCell({ phone }: { phone: string | null }) {
  if (!phone) return <span className="text-faint">—</span>;

  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return <>{phone}</>;

  return (
    <a
      href={`https://wa.me/${digits}`}
      target="_blank"
      rel="noreferrer"
      title="Написать в WhatsApp"
      className="inline-flex items-center gap-1.5 rounded-control text-ink-soft transition-colors hover:text-lime focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime"
    >
      {phone}
      <IconWhatsapp className="size-3.5 shrink-0 opacity-60" />
    </a>
  );
}
