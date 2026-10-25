import { DuesPage } from '@/components/DuesPage';

export const metadata = { title: 'To Collect' };

export default async function CollectPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <DuesPage kind="collection_due" sp={await searchParams} />;
}
