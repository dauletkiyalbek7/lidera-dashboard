'use client';

import { useState } from 'react';

import {
  WEEKDAYS,
  WORK_DAY_PRESETS,
  WORK_TIME_PRESETS,
  formatDuration,
  formatWorkDays,
  hhmm,
  shiftDurationMinutes,
} from '@/lib/attendance';

/**
 * Редактор графика работы: рабочие дни, начало и конец дня, допуск опоздания.
 *
 * Один компонент на настройки компании и на карточку сотрудника — иначе два
 * экрана про одно и то же разъедутся по правилам и по виду. Наружу он отдаёт
 * обычные поля формы, так что server action читает их как всегда.
 *
 * Всё считается на глазах у директора: рядом с временем видно длину смены и
 * недельную норму часов — «09:00 и 18:00» без этого не говорят ничего.
 */

export type ScheduleNames = {
  days: string;
  start: string;
  end: string;
  grace: string;
};

export type ScheduleValue = {
  days: number[];
  start: string;
  end: string;
  grace: number;
};

const GRACE_PRESETS = [0, 5, 10, 15, 30];

export function WorkScheduleEditor({
  names,
  defaults,
}: {
  names: ScheduleNames;
  defaults: ScheduleValue;
}) {
  const [days, setDays] = useState<number[]>(defaults.days);
  const [start, setStart] = useState(hhmm(defaults.start));
  const [end, setEnd] = useState(hhmm(defaults.end));
  const [grace, setGrace] = useState(String(defaults.grace));

  const perDay = shiftDurationMinutes(start, end);
  const perWeek = perDay * days.length;
  const overnight = perDay > 0 && end <= start;

  const toggle = (day: number) =>
    setDays((current) =>
      current.includes(day) ? current.filter((value) => value !== day) : [...current, day],
    );

  const samePreset = (preset: number[]) =>
    preset.length === days.length && preset.every((day) => days.includes(day));

  return (
    <div className="space-y-4">
      {/* Рабочие дни */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-ink-soft">Рабочие дни</span>
          <div className="flex gap-1.5">
            {WORK_DAY_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setDays(preset.days)}
                title={preset.hint}
                className={`h-7 rounded-control px-2.5 text-[12px] font-medium transition-colors ${
                  samePreset(preset.days)
                    ? 'bg-lime/15 text-lime'
                    : 'text-muted hover:bg-surface-2 hover:text-ink'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-1.5">
          {WEEKDAYS.map((day) => {
            const on = days.includes(day.value);
            return (
              <label
                key={day.value}
                title={day.label}
                className={`flex h-10 flex-1 cursor-pointer items-center justify-center rounded-control border text-[13px] font-medium transition-colors ${
                  on
                    ? 'border-lime/40 bg-lime/[0.10] text-ink'
                    : 'border-line bg-surface-2 text-faint hover:border-line-strong'
                }`}
              >
                <input
                  type="checkbox"
                  name={names.days}
                  value={day.value}
                  checked={on}
                  onChange={() => toggle(day.value)}
                  className="sr-only"
                />
                {day.short}
              </label>
            );
          })}
        </div>

        {days.length === 0 ? (
          <p className="text-[12px] text-negative">Выберите хотя бы один рабочий день.</p>
        ) : null}
      </div>

      {/* Время смены */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-ink-soft">Время смены</span>
          <div className="flex flex-wrap gap-1.5">
            {WORK_TIME_PRESETS.map((preset) => (
              <button
                key={preset.start}
                type="button"
                onClick={() => {
                  setStart(preset.start);
                  setEnd(preset.end);
                }}
                className={`tabular h-7 rounded-control px-2.5 text-[12px] font-medium transition-colors ${
                  start === preset.start && end === preset.end
                    ? 'bg-lime/15 text-lime'
                    : 'text-muted hover:bg-surface-2 hover:text-ink'
                }`}
              >
                {preset.start}–{preset.end}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-end gap-2">
          <TimeInput
            label="Начало"
            name={names.start}
            value={start}
            onChange={setStart}
          />
          <span className="pb-3 text-[13px] text-faint">—</span>
          <TimeInput label="Конец" name={names.end} value={end} onChange={setEnd} />
          <div className="pb-1 pl-1">
            <span className="block text-[11.5px] text-faint">Смена</span>
            <span className="tabular block text-[14px] font-medium text-ink">
              {perDay ? formatDuration(perDay) : '—'}
            </span>
          </div>
        </div>

        {overnight ? (
          <p className="text-[12px] text-faint">
            Ночная смена: заканчивается на следующий день.
          </p>
        ) : null}
      </div>

      {/* Допуск опоздания */}
      <div className="space-y-2">
        <span className="block text-[13px] font-medium text-ink-soft">
          Допустимое опоздание
        </span>
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-1.5">
            {GRACE_PRESETS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setGrace(String(value))}
                className={`tabular h-9 flex-1 rounded-control border text-[13px] transition-colors ${
                  Number(grace) === value
                    ? 'border-lime/40 bg-lime/[0.10] text-ink'
                    : 'border-line bg-surface-2 text-muted hover:border-line-strong'
                }`}
              >
                {value === 0 ? 'без' : `${value} мин`}
              </button>
            ))}
          </div>
          <input
            type="number"
            name={names.grace}
            min={0}
            max={120}
            value={grace}
            onChange={(event) => setGrace(event.target.value)}
            aria-label="Допустимое опоздание, минут"
            className="tabular h-9 w-20 rounded-control border border-line bg-surface-2 px-3 text-center text-[13px] text-ink transition-colors focus:border-lime/50 focus:outline-none"
          />
        </div>
        <p className="text-[12px] text-faint">
          Открыл смену позже — в табеле появится «Опоздал».
        </p>
      </div>

      {/* Итог: что в сумме получилось */}
      <div className="rounded-control border border-line bg-surface-2/40 px-3.5 py-3">
        <p className="text-[13.5px] text-ink">
          {formatWorkDays(days)} · {start || '—'}–{end || '—'}
        </p>
        <p className="tabular mt-0.5 text-[12px] text-faint">
          {perDay ? formatDuration(perDay) : '—'} в день
          {days.length ? ` · ${formatDuration(perWeek)} в неделю` : ''}
          {` · ${days.length} ${days.length === 1 ? 'день' : days.length < 5 ? 'дня' : 'дней'} в неделю`}
        </p>
      </div>
    </div>
  );
}

function TimeInput({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={name} className="block text-[11.5px] text-faint">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="time"
        step={300}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="tabular mt-1 h-11 w-full rounded-control border border-line bg-surface-2 px-3 text-[15px] text-ink transition-colors focus:border-lime/50 focus:outline-none"
      />
    </div>
  );
}
