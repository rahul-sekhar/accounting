import { requireAuthUser } from '../auth';
import Dashboard from '../dashboard';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  await requireAuthUser('/accounts');
  return <Dashboard accountsPage />;
}
