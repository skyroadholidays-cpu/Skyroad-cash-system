'use client';
// A form wired to a server action that:
//  * keeps what you typed if the server rejects it (no React form reset)
//  * disables its submit buttons while saving (no accidental double entries)
//  * shows the server's error message right above the buttons
import { createContext, useActionState, useContext, useEffect, useRef, useTransition, type ReactNode, type FormEvent } from 'react';
import type { FormState } from '@/app/actions';

type Action = (state: FormState, fd: FormData) => Promise<FormState>;
const PendingCtx = createContext(false);

export function ActionForm({ action, children, className, confirm, id }: {
  action: Action; children: ReactNode; className?: string; confirm?: string; id?: string;
}) {
  const [state, dispatch, pending] = useActionState(action, undefined);
  const [, startTransition] = useTransition();
  const busy = useRef(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || busy.current) return;
    if (confirm && !window.confirm(confirm)) return;
    const fd = new FormData(e.currentTarget);
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.name) fd.set(submitter.name, submitter.value);
    busy.current = true;
    startTransition(() => dispatch(fd));
  }

  // release the double-submit guard once the server has answered
  useEffect(() => {
    if (!pending) busy.current = false;
  }, [pending, state]);

  return (
    <form onSubmit={onSubmit} className={className} id={id} noValidate={false}>
      <PendingCtx.Provider value={pending}>
        {children}
        {state?.error && <div className="alert alert-error" role="alert">{state.error}</div>}
        {state?.ok && <div className="alert alert-ok" role="status">{state.ok}</div>}
      </PendingCtx.Provider>
    </form>
  );
}

export function SubmitButton({ children, className = 'btn btn-primary', name, value, pendingText = 'Saving…' }: {
  children: ReactNode; className?: string; name?: string; value?: string; pendingText?: string;
}) {
  const pending = useContext(PendingCtx);
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
