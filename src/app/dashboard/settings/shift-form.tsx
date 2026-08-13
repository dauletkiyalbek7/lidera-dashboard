'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import {
  ATTENDANCE_STATUS,
  ATTENDANCE_STATUS_ORDER,
  AUTOMATIC_ATTENDANCE_STATUSES,
  SHIFT_MODE,
  SHIFT_MODE_ORDER,
  type ShiftMode,
} from '@/lib/attendance';
import { updateShiftSettings, type SettingsState } from './actions';

/**
 * Режим смены, офис и табель.
 *
 * Координаты вводить руками неудобно, поэтому есть кнопка «Взять моё
 * местоположение» — директор нажимает её, сидя в офисе, и поля заполняются.
 */
export function ShiftForm({
  defaults,
  disabled,
}: {
  defaults: {
    shift_mode: string;
    office_lat: number | null;
    office_lng: number | null;
    office_radius_m: number;
    office_label: string;
    timezone: string;
    work_start_time: string;
    late_grace_minutes: number;
    attendance_statuses: string[];
  };
  disabled: boolean;
}) {
  const [state, formAction] = useActionState(updateShiftSettings, {} as SettingsState);
  const [mode, setMode] = useState<ShiftMode>(defaults.shift_mode as ShiftMode);
  const [lat, setLat] = useState(defaults.office_lat?.toString() ?? '');
  const [lng, setLng] = useState(defaults.office_lng?.toString() ?? '');
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const locate = () => {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError('Браузер не умеет определять местоположение.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude.toFixed(6));
        setLng(position.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => {
        setGeoError('Не удалось определить местоположение — разрешите доступ в браузере.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <form action={formAction} className="space-y-5 px-5 py-5 sm:px-6">
      <fieldset disabled={disabled} className="space-y-5">
        <div className="space-y-2">
          <span className="block text-[13px] font-medium text-ink-soft">Режим смены</span>
          {SHIFT_MODE_ORDER.map((key) => (
            <label
              key={key}
              className={`flex cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors ${
                mode === key ? 'border-lime/40 bg-lime/[0.06]' : 'border-line hover:border-line-strong'
              }`}
            >
              <input
                type="radio"
                name="shift_mode"
                value={key}
                checked={mode === key}
                onChange={() => setMode(key)}
                className="mt-0.5 size-4 accent-lime"
              />
              <span>
                <span className="block text-[14px] font-medium text-ink">
                  {SHIFT_MODE[key].label}
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-relaxed text-faint">
                  {SHIFT_MODE[key].hint}
                </span>
              </span>
            </label>
          ))}
        </div>

        {mode === 'geo' ? (
          <div className="space-y-4 rounded-control border border-line bg-surface-2/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-ink-soft">Офис</span>
              <Button type="button" variant="secondary" size="sm" onClick={locate}>
                {locating ? 'Определяем…' : 'Взять моё местоположение'}
              </Button>
            </div>

            <Field
              label="Название точки"
              name="office_label"
              defaultValue={defaults.office_label}
              placeholder="Офис на Абая"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Широта"
                name="office_lat"
                value={lat}
                onChange={(event) => setLat(event.target.value)}
                placeholder="43.238949"
              />
              <Field
                label="Долгота"
                name="office_lng"
                value={lng}
                onChange={(event) => setLng(event.target.value)}
                placeholder="76.889709"
              />
            </div>

            <Field
              label="Радиус, метров"
              name="office_radius_m"
              type="number"
              min={50}
              max={5000}
              step={10}
              defaultValue={String(defaults.office_radius_m)}
              hint="Меньше 50 метров ставить нельзя: точность GPS в городе хуже, и сотрудник в офисе получал бы отказ"
            />

            {geoError ? <p className="text-[12.5px] text-negative">{geoError}</p> : null}
            <p className="text-[12px] leading-relaxed text-faint">
              Координаты можно взять и в Google Maps: долгое нажатие на точку → числа
              вверху экрана.
            </p>
          </div>
        ) : (
          <>
            <input type="hidden" name="office_lat" value={lat} />
            <input type="hidden" name="office_lng" value={lng} />
            <input type="hidden" name="office_radius_m" value={defaults.office_radius_m} />
            <input type="hidden" name="office_label" value={defaults.office_label} />
          </>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Начало рабочего дня"
            name="work_start_time"
            type="time"
            defaultValue={defaults.work_start_time.slice(0, 5)}
          />
          <Field
            label="Допустимое опоздание, минут"
            name="late_grace_minutes"
            type="number"
            min={0}
            max={120}
            defaultValue={String(defaults.late_grace_minutes)}
            hint="После этого смена помечается как опоздание"
          />
        </div>

        <input type="hidden" name="timezone" value={defaults.timezone} />

        <div className="space-y-2">
          <span className="block text-[13px] font-medium text-ink-soft">
            Статусы посещаемости
          </span>
          <p className="text-[12px] leading-relaxed text-faint">
            Первые три ставит система по сменам — их не выключить. Остальные директор
            проставляет вручную в разделе «Посещение».
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ATTENDANCE_STATUS_ORDER.map((status) => {
              const automatic = AUTOMATIC_ATTENDANCE_STATUSES.includes(status);
              return (
                <label key={status} className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    name="attendance_statuses"
                    value={status}
                    defaultChecked={
                      automatic || defaults.attendance_statuses.includes(status)
                    }
                    disabled={automatic}
                    className="mt-0.5 size-4 rounded border-line-strong bg-surface-2 accent-lime"
                  />
                  <span>
                    <span className="block text-[13.5px] text-ink">
                      {ATTENDANCE_STATUS[status].label}
                      {automatic ? (
                        <span className="ml-1.5 text-[11px] text-faint">авто</span>
                      ) : null}
                    </span>
                    <span className="block text-[12px] text-faint">
                      {ATTENDANCE_STATUS[status].hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </fieldset>

      <FormMessage error={state.error} success={state.success} />

      {disabled ? (
        <p className="text-[12.5px] text-faint">Настройки меняет только директор.</p>
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
