import { DuesPage } from '@/components/DuesPage';

export const metadata = { title: 'To Pay' };

export default async function PayPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <DuesPage kind="payment_due" sp={await searchParams} />;
}
