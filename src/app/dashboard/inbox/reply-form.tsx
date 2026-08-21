'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import { sendReply, type ReplyState } from './actions';

/**
 * Поле ответа.
 *
 * Enter отправляет, Shift+Enter переносит строку — как в любом мессенджере:
 * менеджер печатает быстро и тянуться к мышке за каждым сообщением не должен.
 */
export function ReplyForm({ leadId }: { leadId: string }) {
  const [state, formAction] = useActionState(sendReply, {} as ReplyState);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // Отправленное сообщение из поля убираем, отклонённое — оставляем: человек
  // его писал, и терять текст из-за отказа Meta нельзя.
  useEffect(() => {
    if (state.success && fieldRef.current) fieldRef.current.value = '';
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="border-t border-line p-3 sm:p-4">
      <input type="hidden" name="leadId" value={leadId} />

      <div className="flex items-end gap-2">
        <textarea
          ref={fieldRef}
          name="text"
          rows={1}
          placeholder="Написать клиенту…"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
          className="max-h-40 min-h-11 flex-1 resize-y rounded-control border border-line bg-surface px-3.5 py-2.5 text-[14px] text-ink placeholder:text-faint focus:border-lime/50 focus:outline-none"
        />
        <SendButton />
      </div>

      {state.error ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-negative">{state.error}</p>
      ) : null}
    </form>
  );
}

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="h-11 shrink-0">
      {pending ? 'Отправляю…' : 'Отправить'}
    </Button>
  );
}
