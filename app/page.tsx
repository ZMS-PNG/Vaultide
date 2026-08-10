import HomePage from '@/components/home/home-page';

// The product entry is request-rendered so a promoted production alias can
// never retain a stale prerendered home artifact.
export const dynamic = 'force-dynamic';

export default function Page() {
  return <HomePage />;
}
