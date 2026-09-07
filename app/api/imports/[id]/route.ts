import { getDb } from '@/db';
import { pageLimit } from '@/lib/imports';
import { AppError, failure, identity, json } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await identity(request);
    const { id } = await context.params;
    const url = new URL(request.url);
    const limit = pageLimit(url.searchParams.get('limit'));
    if (!limit) throw new AppError('Choose a limit from 1 to 100.');
    const cursorValue = url.searchParams.get('cursor');
    if (cursorValue !== null && !/^\d+$/.test(cursorValue))
      throw new AppError('Invalid outcome cursor.');
    const cursor = cursorValue ? Number(cursorValue) : 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw new AppError('Invalid outcome cursor.');
    const outcome = url.searchParams.get('outcome') || 'all';
    if (!['all', 'duplicate', 'added', 'duplicate_skipped', 'duplicate_enriched'].includes(outcome))
      throw new AppError('Invalid outcome filter.');
    const db = getDb();
    const report = await db
      .prepare(`SELECT i.id,i.account_id,i.filename,i.added,i.skipped,i.enriched,i.report_version,i.created_at,
          a.name account_name,a.bank institution,a.currency
        FROM imports i JOIN accounts a ON a.id=i.account_id AND a.user_id=i.user_id
        WHERE i.id=? AND i.user_id=?`)
      .bind(id, user.userId)
      .first<Record<string, unknown>>();
    if (!report) throw new AppError('Import not found.', 404);
    const detailsAvailable = report.report_version !== null;
    if (!detailsAvailable)
      return json({ import: report, outcomes: [], nextCursor: null, detailsAvailable: false });
    const conditions = ['o.user_id=?', 'o.import_id=?', 'o.row_ordinal>?'];
    const bindings: unknown[] = [user.userId, id, cursor];
    if (outcome === 'duplicate') conditions.push("o.outcome!='added'");
    else if (outcome !== 'all') {
      conditions.push('o.outcome=?');
      bindings.push(outcome);
    }
    const result = await db
      .prepare(`SELECT o.row_ordinal,o.occurrence,o.date,o.description,o.sub_description,o.amount,
          o.outcome,o.transaction_id,o.action_detail,
          CASE WHEN t.id IS NULL THEN NULL ELSE t.id END current_transaction_id
        FROM import_row_outcomes o
        LEFT JOIN transactions t ON t.id=o.transaction_id AND t.user_id=o.user_id
        WHERE ${conditions.join(' AND ')} ORDER BY o.row_ordinal LIMIT ?`)
      .bind(...bindings, limit + 1)
      .all<Record<string, unknown>>();
    const outcomes = result.results.slice(0, limit);
    const last = outcomes.at(-1) as { row_ordinal?: number } | undefined;
    return json({
      import: report,
      outcomes,
      nextCursor: result.results.length > limit ? String(last?.row_ordinal) : null,
      detailsAvailable: true,
    });
  } catch (error) {
    return failure(error);
  }
}
