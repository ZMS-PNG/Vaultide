import HomePage from '@/components/home/home-page';

// The primary entry is intentionally rendered dynamically. A stale prerendered
// `/` artifact can otherwise survive an alias promotion and make the product
// look unavailable even though every dynamic learning route is healthy.
export const dynamic = 'force-dynamic';

export default function HomeRoute() {
  return <HomePage />;
}
