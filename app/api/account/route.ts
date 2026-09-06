import { getDb } from '@/db';
import { parseDate } from '@/lib/banking';
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
      !Number.isSafeInteger(b.balance) ||
      Math.abs(b.balance) > 100_000_000_000 ||
      !parseDate(b.balanceDate, 'YMD')
    )
      throw new AppError('Enter a valid balance and its statement date.');
    const result = await getDb()
      .prepare(
        'UPDATE accounts SET balance=?,balance_date=? WHERE id=? AND user_id=?',
      )
      .bind(b.balance, b.balanceDate, textValue(b.id), u.userId)
      .run();
    if (!result.meta.changes) throw new AppError('Account not found.', 404);
    return json({ saved: true });
  } catch (e) {
    return failure(e);
  }
}
