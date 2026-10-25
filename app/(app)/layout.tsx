import { requireUser } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { logoutAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <Shell username={user.username} logout={logoutAction}>{children}</Shell>;
}
