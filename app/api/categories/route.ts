import { getDb } from '@/db';
import { getCategories } from '@/lib/categories-server';
import {
  identity,
  body,
  json,
  failure,
  textValue,
  AppError,
} from '@/lib/server';
async function save(request: Request, creating: boolean) {
  try {
    const u = await identity(request),
      b = await body(request);
    const current = await getCategories(u.userId);
    const id = creating ? crypto.randomUUID() : textValue(b.id);
    const old = current.find((c) => c.id === id);
    if (!creating && !old) throw new AppError('Category not found.', 404);
    if (id === 'Uncategorized')
      throw new AppError('Uncategorized is the permanent fallback category.');
    const name = textValue(b.name, 60);
    if (
      !['expense', 'income', 'transfer', 'investment'].includes(b.kind) ||
      typeof b.archived !== 'boolean'
    )
      throw new AppError('Choose a valid category type.');
    if (
      current.some(
        (c) =>
          c.id !== id &&
          c.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    )
      throw new AppError(
        'A category with that name already exists, including archived categories.',
      );
    if (creating && current.length >= 100)
      throw new AppError('You can manage up to 100 categories.');
    await getDb()
      .prepare(
        'INSERT INTO category_definitions (user_id,id,name,kind,archived) VALUES (?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET name=excluded.name,kind=excluded.kind,archived=excluded.archived',
      )
      .bind(u.userId, id, name, b.kind, b.archived ? 1 : 0)
      .run();
    return json({ categories: await getCategories(u.userId) });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  return save(request, true);
}
export async function PATCH(request: Request) {
  return save(request, false);
}
