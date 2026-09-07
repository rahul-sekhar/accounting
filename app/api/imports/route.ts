import { getDb } from '@/db';
import { importListCursor, pageLimit, parseImportListCursor } from '@/lib/imports';
import { AppError, failure, identity, json } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await identity(request);
    const url = new URL(request.url);
    const limit = pageLimit(url.searchParams.get('limit'));
    if (!limit) throw new AppError('Choose a limit from 1 to 100.');
    const cursor = parseImportListCursor(url.searchParams.get('cursor'));
    if (cursor === undefined) throw new AppError('Invalid import cursor.');
    const accountId = url.searchParams.get('accountId');
    if (accountId !== null && (!accountId || accountId.length > 100))
      throw new AppError('Invalid account filter.');
    const conditions = ['i.user_id=?'];
    const bindings: unknown[] = [user.userId];
    if (accountId) {
      conditions.push('i.account_id=?');
      bindings.push(accountId);
    }
    if (cursor) {
      conditions.push('(i.created_at<? OR (i.created_at=? AND i.id<?))');
      bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const result = await getDb()
      .prepare(
        `SELECT i.id,i.account_id,i.filename,i.added,i.skipped,i.enriched,i.report_version,i.created_at,
          a.name account_name,a.bank institution,a.currency
         FROM imports i JOIN accounts a ON a.id=i.account_id AND a.user_id=i.user_id
         WHERE ${conditions.join(' AND ')} ORDER BY i.created_at DESC,i.id DESC LIMIT ?`,
      )
      .bind(...bindings, limit + 1)
      .all<Record<string, unknown>>();
    const rows = result.results;
    const items = rows.slice(0, limit);
    const last = items.at(-1) as { created_at?: string; id?: string } | undefined;
    return json({
      items,
      nextCursor:
        rows.length > limit && last?.created_at && last.id
          ? importListCursor(last.created_at, last.id)
          : null,
    });
  } catch (error) {
    return failure(error);
  }
}
