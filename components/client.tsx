'use client';
import { useEffect, type SelectHTMLAttributes } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps every open device in sync: re-fetches the page's data every 20s while
 * the tab is visible, and immediately when you switch back to the tab.
 */
export function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      const el = document.activeElement;
      // don't refresh while you are typing in a field
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      router.refresh();
    };
    const id = window.setInterval(tick, seconds * 1000);
    const onVis = () => document.visibilityState === 'visible' && router.refresh();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [router, seconds]);
  return null;
}

export function PrintButton({ label = 'Print / Save as PDF' }: { label?: string }) {
  return (
    <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
      {label}
    </button>
  );
}

/** Auto-submits a GET filter form when a select changes. */
export function AutoSubmitSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
