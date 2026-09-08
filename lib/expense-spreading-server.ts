import { AppError } from './errors';
import { validateSchedule, type SpreadSchedule } from './expense-spreading';

type SavedReceipt = { request_hash: string; result_json: string };
async function hash(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function receipt(db: D1Database, userId: string, operationId: string) {
  return db.prepare('SELECT request_hash,result_json FROM operation_receipts WHERE user_id=? AND kind=\'spread\' AND operation_id=?').bind(userId, operationId).first<SavedReceipt>();
}
function replay(saved: SavedReceipt, requestHash: string) {
  if (saved.request_hash !== requestHash) throw new AppError('This spread operation ID was already used for different values.', 409, 'operation_conflict');
  return { ...(JSON.parse(saved.result_json) as object), replayed: true };
}
export async function saveSpread(db: D1Database, userId: string, input: { id: string; operationId: string; expectedRevision: number; schedule: SpreadSchedule | null }) {
  const requestHash = await hash({ id: input.id, expectedRevision: input.expectedRevision, schedule: input.schedule });
  const existing = await receipt(db, userId, input.operationId);
  if (existing) return replay(existing, requestHash);
  const schedule = validateSchedule(input.schedule);
  const start = schedule?.startMonth ?? null;
  const count = schedule?.monthCount ?? null;
  const result = { operationId: input.operationId, transactionId: input.id, schedule, revision: input.expectedRevision + 1 };
  const now = new Date().toISOString();
  const resultJson = JSON.stringify(result);
  try {
    await db.batch([
      db.prepare(`UPDATE transactions SET spread_start_month=?,spread_month_count=?,spread_revision=spread_revision+1
        WHERE id=? AND user_id=? AND spread_revision=? AND (? IS NULL OR (amount<>0 AND (
          amount<0 AND category='Uncategorized' OR EXISTS (SELECT 1 FROM category_definitions c WHERE c.user_id=? AND c.id=transactions.category AND c.kind='expense')
        )))`).bind(start, count, input.id, userId, input.expectedRevision, start, userId),
      db.prepare(`INSERT INTO operation_receipts (user_id,kind,operation_id,request_hash,result_json,committed_at)
        SELECT ?,'spread',?,?,?,?,? WHERE EXISTS (SELECT 1 FROM transactions WHERE id=? AND user_id=? AND spread_revision=? AND spread_start_month IS ? AND spread_month_count IS ?)`)
        .bind(userId, input.operationId, requestHash, resultJson, now, input.id, userId, input.expectedRevision + 1, start, count),
    ]);
  } catch {
    const competing = await receipt(db, userId, input.operationId);
    if (competing) return replay(competing, requestHash);
    throw new AppError('The spread was not saved. Your transaction is unchanged.', 503, 'spread_not_committed');
  }
  const committed = await receipt(db, userId, input.operationId);
  if (!committed) {
    const current = await db.prepare('SELECT spread_revision FROM transactions WHERE id=? AND user_id=?').bind(input.id, userId).first<{ spread_revision: number }>();
    if (!current) throw new AppError('Transaction not found.', 404);
    if (current.spread_revision !== input.expectedRevision) throw new AppError('This transaction changed. Reload it before saving the spread.', 409, 'stale_spread');
    throw new AppError('The spread could not be committed. Refresh and try again.', 503, 'spread_not_committed');
  }
  return { ...(JSON.parse(committed.result_json) as object), replayed: false };
}
