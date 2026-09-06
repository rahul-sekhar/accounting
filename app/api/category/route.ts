import { getDb } from '@/db';
import { getCategories } from '@/lib/categories-server';
import {
  identity,
  json,
  failure,
  body,
  AppError,
  textValue,
} from '@/lib/server';
export async function PATCH(request: Request) {
  try {
    const u = await identity(request);
    const b = await body(request);
    if (
      !(await getCategories(u.userId)).some(
        (c) => c.id === b.category && !c.archived,
      )
    )
      throw new AppError('Choose a valid category.');
    const result = await getDb()
      .prepare(
        "UPDATE transactions SET category=?,source='manual',confidence=NULL WHERE id=? AND user_id=?",
      )
      .bind(b.category, textValue(b.id), u.userId)
      .run();
    if (!result.meta.changes) throw new AppError('Transaction not found.', 404);
    return json({ saved: true });
  } catch (e) {
    return failure(e);
  }
}
