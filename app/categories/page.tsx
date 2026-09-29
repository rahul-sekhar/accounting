import { requireAuthUser } from '../auth';
import Dashboard from '../dashboard';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  await requireAuthUser('/categories');
  return <Dashboard categoriesPage />;
}
