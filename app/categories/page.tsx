import { requireChatGPTUser } from '../chatgpt-auth';
import Dashboard from '../dashboard';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  await requireChatGPTUser('/categories');
  return <Dashboard categoriesPage />;
}
