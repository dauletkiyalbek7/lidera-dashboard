'use client';

import { useActionState, useState } from 'react';

import { Done, SubmitButton } from '@/app/dashboard/leads/lead-controls';
import { Field, FormMessage } from '@/components/auth/field';
import { Button } from '@/components/ui/button';
import { Modal, Select } from '@/components/ui/modal';
import { ATTENDANCE_STATUS, type AttendanceStatus } from '@/lib/attendance';
import { markAttendance, type AttendanceState } from './actions';

/**
 * Ручная отметка. Автоматические статусы («на смене», «опоздал») здесь не
 * предлагаются: их ставит система по фактическим сменам, и подменять факт
 * вручную нельзя — иначе табель перестанет быть доказательством.
 */
export function MarkButton({
  employeeId,
  fullName,
  statuses,
  today,
}: {
  employeeId: string;
  fullName: string;
  statuses: AttendanceStatus[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(markAttendance, {} as AttendanceState);

  if (statuses.length === 0) return null;

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Отметить
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Отметка в табеле"
        description={fullName}
      >
        {state.success ? (
          <Done message={state.success} onClose={() => setOpen(false)} />
        ) : (
          <form action={formAction} className="space-y-4 px-5 py-5 sm:px-6">
            <input type="hidden" name="employeeId" value={employeeId} />
            <Field label="Дата" name="date" type="date" required defaultValue={today} />
            <Select
              label="Статус"
              name="status"
              options={statuses.map((status) => ({
                value: status,
                label: ATTENDANCE_STATUS[status].label,
              }))}
            />
            <Field label="Комментарий" name="note" placeholder="Необязательно" />
            <FormMessage error={state.error} />
            <SubmitButton label="Сохранить" pendingLabel="Сохраняем…" />
          </form>
        )}
      </Modal>
    </>
  );
}
