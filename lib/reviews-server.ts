import { getDb } from '@/db';
import { getCategories } from './categories-server';
import { AppError } from './server';
import type { ReviewMemoryRow } from './review-memory';

type TransactionSnapshot = {
  id: string;
  category: string;
  source: string;
  confidence: string | null;
  category_revision: number;
  description: string;
  sub_description: string;
  amount: number;
  account_id: string;
  account_type: string;
  currency: string;
  memory_enabled: number | null;
};

export async function getContextRevision(userId: string) {
  const row = await getDb()
    .prepare('SELECT revision FROM categorization_contexts WHERE user_id=?')
    .bind(userId)
    .first<{ revision: number }>();
  return row?.revision || 0;
}

export async function loadReviewRows(userId: string, pageSize = 500) {
  const db = getDb();
  const rows: ReviewMemoryRow[] = [];
  let after = '';
  while (true) {
    const page = (
      await db
        .prepare(
          `SELECT r.transaction_id,r.category_id,r.memory_enabled,r.revision,r.reviewed_at,
            r.description,r.sub_description,r.amount,r.currency,r.account_id,r.account_type,r.origin
           FROM transaction_reviews r
           JOIN transactions t ON t.id=r.transaction_id AND t.user_id=r.user_id
           WHERE r.user_id=? AND r.transaction_id>? ORDER BY r.transaction_id LIMIT ?`,
        )
        .bind(userId, after, pageSize)
        .all<{
          transaction_id: string;
          category_id: string;
          memory_enabled: number;
          revision: number;
          reviewed_at: string | null;
          description: string;
          sub_description: string;
          amount: number;
          currency: string;
          account_id: string;
          account_type: string;
          origin: string;
        }>()
    ).results;
    rows.push(
      ...page.map((row) => ({
        transactionId: row.transaction_id,
        revision: row.revision,
        categoryId: row.category_id,
        memoryEnabled: row.memory_enabled,
        reviewedAt: row.reviewed_at,
        description: row.description,
        subDescription: row.sub_description,
        amount: row.amount,
        currency: row.currency,
        accountId: row.account_id,
        accountType: row.account_type,
        origin: row.origin,
      })),
    );
    if (page.length < pageSize) break;
    after = page.at(-1)!.transaction_id;
  }
  return rows;
}

function reviewInput(value: {
  transactionId: string;
  category: string;
  action: string;
  learn: boolean;
  expectedRevision: number;
}) {
  return JSON.stringify(value);
}

export async function saveReview(
  userId: string,
  input: {
    id: string;
    category: string;
    action: 'correct' | 'confirm' | 'memory_enable' | 'memory_disable';
    learn: boolean;
    operationId: string;
    expectedRevision: number;
  },
) {
  const db = getDb();
  const inputHash = reviewInput({
    transactionId: input.id,
    category: input.category,
    action: input.action,
    learn: input.learn,
    expectedRevision: input.expectedRevision,
  });
  const existing = await db
    .prepare(
      `SELECT e.input_hash,e.resulting_category_id,e.resulting_memory_enabled,
        e.resulting_revision,e.reviewed_at,
        EXISTS(SELECT 1 FROM transactions t WHERE t.id=e.transaction_id AND t.user_id=e.user_id) transaction_exists
       FROM transaction_review_events e WHERE e.user_id=? AND e.operation_id=?`,
    )
    .bind(userId, input.operationId)
    .first<{
      input_hash: string;
      resulting_category_id: string;
      resulting_memory_enabled: number;
      resulting_revision: number;
      reviewed_at: string | null;
      transaction_exists: number;
    }>();
  if (existing) {
    if (existing.input_hash !== inputHash)
      throw new AppError(
        'This review operation was already used for different changes.',
        409,
      );
    if (!existing.transaction_exists)
      throw new AppError('Transaction not found.', 404);
    return {
      saved: true,
      replayed: true,
      category: existing.resulting_category_id,
      memoryEnabled: Boolean(existing.resulting_memory_enabled),
      categoryRevision: existing.resulting_revision,
      reviewedAt: existing.reviewed_at,
    };
  }
  const row = await db
    .prepare(
      'SELECT t.id,t.category,t.source,t.confidence,t.category_revision,t.description,t.sub_description,t.amount,t.account_id,a.type account_type,a.currency,r.memory_enabled FROM transactions t JOIN accounts a ON a.id=t.account_id AND a.user_id=t.user_id LEFT JOIN transaction_reviews r ON r.user_id=t.user_id AND r.transaction_id=t.id WHERE t.id=? AND t.user_id=?',
    )
    .bind(input.id, userId)
    .first<TransactionSnapshot>();
  if (!row) throw new AppError('Transaction not found.', 404);
  if (row.category_revision !== input.expectedRevision)
    throw new AppError('This transaction changed. Refresh and try again.', 409);
  const toggling =
    input.action === 'memory_enable' || input.action === 'memory_disable';
  if (toggling && row.memory_enabled === null)
    throw new AppError(
      'Review this transaction before changing its memory setting.',
    );
  if (
    (input.action === 'confirm' || toggling) &&
    input.category !== row.category
  )
    throw new AppError('The category changed. Refresh and try again.', 409);
  const categories = await getCategories(userId);
  const category = categories.find((item) => item.id === input.category);
  if (!category || (category.archived && input.category !== row.category))
    throw new AppError('Choose a valid category.');
  const nextLearn = toggling ? input.action === 'memory_enable' : input.learn;
  const now = new Date().toISOString();
  const reviewedAt = now;
  const nextRevision = row.category_revision + 1;
  const previousMemory = row.memory_enabled;
  const statements = [
    db
      .prepare(
        `INSERT INTO transaction_review_events (operation_id,user_id,transaction_id,action,previous_category_id,resulting_category_id,previous_source,previous_confidence,previous_memory_enabled,resulting_memory_enabled,description,sub_description,amount,currency,account_id,account_type,recorded_at,reviewed_at,resulting_revision,origin,input_hash)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM transactions WHERE id=? AND user_id=? AND category_revision=?`,
      )
      .bind(
        input.operationId,
        userId,
        row.id,
        input.action,
        row.category,
        input.category,
        row.source,
        row.confidence,
        previousMemory,
        nextLearn ? 1 : 0,
        row.description,
        row.sub_description,
        row.amount,
        row.currency,
        row.account_id,
        row.account_type,
        now,
        reviewedAt,
        nextRevision,
        'user',
        inputHash,
        row.id,
        userId,
        input.expectedRevision,
      ),
    db
      .prepare(
        `INSERT INTO transaction_reviews (user_id,transaction_id,latest_operation_id,category_id,memory_enabled,revision,reviewed_at,description,sub_description,amount,currency,account_id,account_type,origin)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM transactions WHERE id=? AND user_id=? AND category_revision=?
         ON CONFLICT(user_id,transaction_id) DO UPDATE SET latest_operation_id=excluded.latest_operation_id,category_id=excluded.category_id,memory_enabled=excluded.memory_enabled,revision=excluded.revision,reviewed_at=excluded.reviewed_at,description=excluded.description,sub_description=excluded.sub_description,amount=excluded.amount,currency=excluded.currency,account_id=excluded.account_id,account_type=excluded.account_type,origin=excluded.origin`,
      )
      .bind(
        userId,
        row.id,
        input.operationId,
        input.category,
        nextLearn ? 1 : 0,
        nextRevision,
        reviewedAt,
        row.description,
        row.sub_description,
        row.amount,
        row.currency,
        row.account_id,
        row.account_type,
        'user',
        row.id,
        userId,
        input.expectedRevision,
      ),
    toggling
      ? db
          .prepare(
            'UPDATE transactions SET category_revision=? WHERE id=? AND user_id=? AND category_revision=?',
          )
          .bind(nextRevision, row.id, userId, input.expectedRevision)
      : db
          .prepare(
            "UPDATE transactions SET category=?,source='manual',confidence=NULL,category_revision=?,categorization_evidence=NULL WHERE id=? AND user_id=? AND category_revision=?",
          )
          .bind(
            input.category,
            nextRevision,
            row.id,
            userId,
            input.expectedRevision,
          ),
    db
      .prepare(
        `INSERT INTO categorization_contexts (user_id,revision)
         SELECT ?,1 WHERE EXISTS (SELECT 1 FROM transactions WHERE id=? AND user_id=? AND category_revision=?)
         ON CONFLICT(user_id) DO UPDATE SET revision=revision+1`,
      )
      .bind(userId, row.id, userId, nextRevision),
  ];
  try {
    const results = await db.batch(statements);
    if (
      !results[0].meta.changes ||
      !results[1].meta.changes ||
      !results[2].meta.changes
    )
      throw new AppError(
        'This transaction changed. Refresh and try again.',
        409,
      );
  } catch (error) {
    const replay = await db
      .prepare(
        'SELECT input_hash FROM transaction_review_events WHERE user_id=? AND operation_id=?',
      )
      .bind(userId, input.operationId)
      .first<{ input_hash: string }>();
    if (replay) {
      if (replay.input_hash !== inputHash)
        throw new AppError(
          'This review operation was already used for different changes.',
          409,
        );
      return saveReview(userId, input);
    }
    throw error;
  }
  return {
    saved: true,
    replayed: false,
    category: input.category,
    source: toggling ? row.source : 'manual',
    confidence: toggling ? row.confidence : null,
    memoryEnabled: nextLearn,
    categoryRevision: nextRevision,
    reviewedAt,
  };
}

export async function backfillLegacyReviews(userId: string, limit = 50) {
  const db = getDb();
  const rows = (
    await db
      .prepare(
        "SELECT t.id,t.category,t.source,t.confidence,t.category_revision,t.description,t.sub_description,t.amount,t.account_id,a.type account_type,a.currency FROM transactions t JOIN accounts a ON a.id=t.account_id AND a.user_id=t.user_id LEFT JOIN transaction_reviews r ON r.user_id=t.user_id AND r.transaction_id=t.id WHERE t.user_id=? AND t.source='manual' AND r.transaction_id IS NULL ORDER BY t.id LIMIT ?",
      )
      .bind(userId, Math.max(1, Math.min(100, limit)))
      .all<TransactionSnapshot>()
  ).results;
  let seeded = 0;
  for (const row of rows) {
    const operationId = `legacy_seed:${row.id}`;
    const inputHash = `legacy:${row.id}:${row.category}`;
    const now = new Date().toISOString();
    const result = await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO transaction_review_events (operation_id,user_id,transaction_id,action,previous_category_id,resulting_category_id,previous_source,previous_confidence,previous_memory_enabled,resulting_memory_enabled,description,sub_description,amount,currency,account_id,account_type,recorded_at,reviewed_at,resulting_revision,origin,input_hash)
           SELECT ?,?,t.id,'legacy_seed',NULL,t.category,t.source,t.confidence,NULL,1,t.description,t.sub_description,t.amount,a.currency,t.account_id,a.type,?,NULL,t.category_revision,'legacy_backfill',?
           FROM transactions t JOIN accounts a ON a.id=t.account_id AND a.user_id=t.user_id WHERE t.id=? AND t.user_id=? AND NOT EXISTS (SELECT 1 FROM transaction_reviews r WHERE r.user_id=t.user_id AND r.transaction_id=t.id)`,
        )
        .bind(operationId, userId, now, inputHash, row.id, userId),
      db
        .prepare(
          `INSERT INTO categorization_contexts (user_id,revision)
           SELECT ?,1 WHERE NOT EXISTS (SELECT 1 FROM transaction_reviews WHERE user_id=? AND transaction_id=?)
           ON CONFLICT(user_id) DO UPDATE SET revision=revision+1`,
        )
        .bind(userId, userId, row.id),
      db
        .prepare(
          `INSERT OR IGNORE INTO transaction_reviews (user_id,transaction_id,latest_operation_id,category_id,memory_enabled,revision,reviewed_at,description,sub_description,amount,currency,account_id,account_type,origin)
           SELECT ?,t.id,?,t.category,1,t.category_revision,NULL,t.description,t.sub_description,t.amount,a.currency,t.account_id,a.type,'legacy_backfill'
           FROM transactions t JOIN accounts a ON a.id=t.account_id AND a.user_id=t.user_id WHERE t.id=? AND t.user_id=? AND NOT EXISTS (SELECT 1 FROM transaction_reviews r WHERE r.user_id=t.user_id AND r.transaction_id=t.id)`,
        )
        .bind(userId, operationId, row.id, userId),
    ]);
    if (result[2].meta.changes) {
      seeded++;
    }
  }
  const remaining = await db
    .prepare(
      "SELECT COUNT(*) count FROM transactions t LEFT JOIN transaction_reviews r ON r.user_id=t.user_id AND r.transaction_id=t.id WHERE t.user_id=? AND t.source='manual' AND r.transaction_id IS NULL",
    )
    .bind(userId)
    .first<{ count: number }>();
  return {
    seeded,
    remaining: remaining?.count || 0,
    complete: !remaining?.count,
  };
}
