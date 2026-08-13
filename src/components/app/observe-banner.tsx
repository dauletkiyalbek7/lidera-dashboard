import { stopObserving } from '@/app/admin/actions';

/**
 * Полоса режима наблюдения.
 *
 * Администратор платформы смотрит чужой кабинет: важно, чтобы он ни на секунду
 * не спутал его со своим и всегда видел выход одной кнопкой.
 */
export function ObserveBanner({ companyName }: { companyName: string }) {
  return (
    <div className="sticky top-0 z-30 border-b border-lime/30 bg-lime/10 px-4 py-2.5 backdrop-blur sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <p className="text-[13px] text-ink">
          <span className="font-medium">Режим наблюдения</span> — кабинет компании «
          {companyName}». Только просмотр: изменения делает директор.
        </p>
        <form action={stopObserving}>
          <button
            type="submit"
            className="rounded-control border border-lime/40 px-3 py-1.5 text-[12.5px] font-medium text-lime transition-colors hover:bg-lime/15"
          >
            Выйти из наблюдения
          </button>
        </form>
      </div>
    </div>
  );
}
