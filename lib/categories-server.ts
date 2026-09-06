import { getDb } from '@/db';
import { DEFAULT_CATEGORIES, type CategoryDefinition } from './banking';
export async function getCategories(
  userId: string,
): Promise<CategoryDefinition[]> {
  const overrides = (
    await getDb()
      .prepare(
        'SELECT id,name,kind,archived FROM category_definitions WHERE user_id=? ORDER BY name',
      )
      .bind(userId)
      .all<CategoryDefinition>()
  ).results;
  const result = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, { ...c }]));
  for (const row of overrides)
    result.set(row.id, { ...row, archived: Boolean(row.archived) });
  return [...result.values()];
}
