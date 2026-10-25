'use server';
// Every mutation in the app goes through these server actions. Each one
// re-checks the session, validates input on the server, and returns a
// readable error instead of a half-finished change.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ensureDb } from '@/lib/db';
import { requireUser, setSessionCookie, clearSessionCookie, readSessionToken, clientInfo } from '@/lib/session';
import { friendlyError, UserError } from '@/lib/db-core';
import * as auth from '@/lib/auth-core';
import * as L from '@/lib/ledger';
import * as FX from '@/lib/forex';
import * as PT from '@/lib/parties';

export type FormState = { error?: string; ok?: string } | undefined;

const refresh = () => revalidatePath('/', 'layout');
const safeNext = (v: FormDataEntryValue | null, fallback: string) => {
  const s = typeof v === 'string' ? v : '';
  return s.startsWith('/') && !s.startsWith('//') ? s : fallback;
};

// ───────────────────────── auth ─────────────────────────

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  ensureDb();
  const { ip, userAgent } = await clientInfo();
  try {
    const token = await auth.login(String(fd.get('username') ?? '').trim(), String(fd.get('password') ?? ''), ip, userAgent);
    await setSessionCookie(token);
  } catch (e) {
    return { error: friendlyError(e) };
  }
  redirect(safeNext(fd.get('next'), '/'));
}

export async function setupAction(_: FormState, fd: FormData): Promise<FormState> {
  ensureDb();
  const { ip, userAgent } = await clientInfo();
  try {
    const expected = process.env.SETUP_TOKEN;
    if (!expected || expected.length < 12) throw new UserError('Setup is disabled: SETUP_TOKEN is not configured on the server (see README).');
    if (String(fd.get('setup_token') ?? '') !== expected) throw new UserError('The setup code is incorrect.');
    await auth.setInitialPassword(String(fd.get('password') ?? ''), String(fd.get('confirm') ?? ''));
    const token = await auth.login('Skyroadholidays', String(fd.get('password')), ip, userAgent);
    await setSessionCookie(token);
  } catch (e) {
    return { error: friendlyError(e) };
  }
  redirect('/cash?welcome=1');
}

export async function logoutAction() {
  ensureDb();
  await auth.destroySession(await readSessionToken());
  await clearSessionCookie();
  redirect('/login');
}

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await auth.changePassword(user, String(fd.get('current') ?? ''), String(fd.get('password') ?? ''), String(fd.get('confirm') ?? ''));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  return { ok: 'Password changed. All other devices have been signed out.' };
}

export async function signOutOthersAction(_: FormState): Promise<FormState> {
  const user = await requireUser();
  const n = await auth.signOutOtherSessions(user);
  refresh();
  return { ok: n ? `Signed out ${n} other device${n > 1 ? 's' : ''}.` : 'No other devices were signed in.' };
}

// ───────────────────────── transactions ─────────────────────────

export async function createTxnAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  let res: L.SaveResult;
  try {
    res = await L.createTxn(user.username, L.parseTxnInput(L.getterFrom(fd)), String(fd.get('idem') ?? '') || null);
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  if (fd.get('and_new') === '1') redirect(`/transactions/new?type=${fd.get('type')}&saved=${res.txn_no}${fd.get('entry_for') ? `&for=${fd.get('entry_for')}` : ''}`);
  redirect(`/transactions/${res.id}?saved=1`);
}

export async function updateTxnAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(fd.get('id') ?? '');
  try {
    await L.updateTxn(user.username, id, L.parseTxnInput(L.getterFrom(fd)));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect(`/transactions/${id}?saved=1`);
}

export async function deleteTxnAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await L.softDeleteTxn(user.username, String(fd.get('id') ?? ''));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect(safeNext(fd.get('next'), '/transactions') + (String(fd.get('next') ?? '').includes('?') ? '&' : '?') + 'deleted=1');
}

export async function restoreTxnAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(fd.get('id') ?? '');
  try {
    await L.restoreTxn(user.username, id);
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect(`/transactions/${id}?restored=1`);
}

export async function settleAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const dueId = String(fd.get('due_id') ?? '');
  let back = '/collect';
  try {
    const due = await L.getDue(dueId);
    back = due?.type === 'payment_due' ? '/pay' : '/collect';
    const r = await L.settleDue(user.username, dueId, L.getterFrom(fd), String(fd.get('idem') ?? '') || null);
    back += `?saved=${r.txn_no}`;
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect(safeNext(fd.get('next'), back));
}

// ───────────────────────── bookings ─────────────────────────

export async function createBookingAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  let id: number;
  try {
    const get = L.getterFrom(fd);
    ({ id } = await L.createBooking(user.username, L.parseBookingInput(get), L.parseBookingExtras(get), String(fd.get('idem') ?? '') || null));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect(`/bookings/${id}?saved=1`);
}

export async function updateBookingAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = Number(fd.get('id'));
  try {
    const get = L.getterFrom(fd);
    await L.updateBooking(user.username, id, L.parseBookingInput(get), L.parseBookingExtras(get));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect(`/bookings/${id}?saved=1`);
}

export async function deleteBookingAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await L.deleteBooking(user.username, Number(fd.get('id')));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect('/bookings?deleted=1');
}

// ───────────────────────── cash locations ─────────────────────────

export async function saveLocationAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = Number(fd.get('id') ?? 0);
  try {
    if (id) await L.updateLocation(user.username, id, L.getterFrom(fd));
    else await L.createLocation(user.username, L.getterFrom(fd));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect('/cash?saved=1');
}

export async function toggleLocationAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await L.setLocationActive(user.username, Number(fd.get('id')), fd.get('active') === 'true');
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect('/cash');
}

export async function cashCountAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  let r: Awaited<ReturnType<typeof L.recordCashCount>>;
  try {
    r = await L.recordCashCount(user.username, L.getterFrom(fd));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect(`/cash?counted=${encodeURIComponent(r.difference)}`);
}

// ───────────────────────── forex reserve ─────────────────────────

export async function createFxAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  let code = '';
  let no = '';
  try {
    const input = FX.parseFxInput(L.getterFrom(fd));
    code = input.currency;
    ({ fx_no: no } = await FX.createFx(user.username, input, String(fd.get('idem') ?? '') || null));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect(`/forex/${code}?saved=${no}`);
}

export async function updateFxAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  let code = '';
  try {
    const input = FX.parseFxInput(L.getterFrom(fd));
    code = input.currency;
    await FX.updateFx(user.username, String(fd.get('id') ?? ''), input);
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect(`/forex/${code}?updated=1`);
}

export async function deleteFxAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await FX.deleteFx(user.username, String(fd.get('id') ?? ''));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect(`/forex/${String(fd.get('currency') ?? '')}?deleted=1`);
}

export async function restoreFxAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await FX.restoreFx(user.username, String(fd.get('id') ?? ''));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect(`/forex/${String(fd.get('currency') ?? '')}?restored=1`);
}

export async function saveFxCurrencyAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await FX.saveFxCurrency(user.username, L.getterFrom(fd));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect('/forex?saved=1');
}

export async function toggleFxCurrencyAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await FX.setFxCurrencyActive(user.username, String(fd.get('code') ?? ''), fd.get('active') === 'true');
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect('/forex');
}

// ───────────────────────── parties ─────────────────────────

export async function savePartyAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  let id: number;
  try {
    id = await PT.saveParty(user.username, Number(fd.get('id')) || null, L.getterFrom(fd));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect(`/parties/${id}?saved=1`);
}

export async function togglePartyAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = Number(fd.get('id'));
  try {
    await PT.setPartyActive(user.username, id, fd.get('active') === 'true');
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect(fd.get('active') === 'true' ? `/parties/${id}` : '/parties?archived=1');
}

export async function createPartyTxnAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  let no = '';
  const pid = Number(fd.get('party_id'));
  try {
    ({ pt_no: no } = await PT.createPartyTxn(user.username, PT.parsePartyTxnInput(L.getterFrom(fd)), String(fd.get('idem') ?? '') || null));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect(`/parties/${pid}?added=${no}`);
}

export async function updatePartyTxnAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const pid = Number(fd.get('party_id'));
  try {
    await PT.updatePartyTxn(user.username, String(fd.get('id') ?? ''), PT.parsePartyTxnInput(L.getterFrom(fd)));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect(`/parties/${pid}?updated=1`);
}

export async function deletePartyTxnAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await PT.deletePartyTxn(user.username, String(fd.get('id') ?? ''));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect(`/parties/${Number(fd.get('party_id'))}?deleted=1`);
}

export async function restorePartyTxnAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await PT.restorePartyTxn(user.username, String(fd.get('id') ?? ''));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  redirect(`/parties/${Number(fd.get('party_id'))}?restored=1`);
}
