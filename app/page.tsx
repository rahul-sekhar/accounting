import { requireAuthUser } from './auth';
import Dashboard from './dashboard';
export const dynamic = 'force-dynamic';
export default async function Home() {
  await requireAuthUser('/');
  return <Dashboard />;
}
