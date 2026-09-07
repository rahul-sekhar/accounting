import { AppError } from './server';

export type DeleteReceiptResult = {
  operationId: string;
  deletedIds: string[];
  unavailableIds: string[];
};

type ReceiptRow = { request_hash: string; result_json: string };

async function readReceipt(
  db: D1Database,
  userId: string,
  kind: string,
  operationId: string,
) {
  return db
    .prepare(
      'SELECT request_hash,result_json FROM operation_receipts WHERE user_id=? AND kind=? AND operation_id=?',
    )
    .bind(userId, kind, operationId)
    .first<ReceiptRow>();
}

function replayDeleteReceipt(saved: ReceiptRow, requestHash: string) {
  if (saved.request_hash !== requestHash)
    throw new AppError(
      'This delete operation ID was already used for a different selection.',
      409,
      'operation_conflict',
    );
  return {
    ...(JSON.parse(saved.result_json) as DeleteReceiptResult),
    replayed: true,
  };
}

export async function deleteTransactions(
  db: D1Database,
  userId: string,
  operationId: string,
  ids: readonly string[],
  requestHash: string,
) {
  const saved = await readReceipt(db, userId, 'delete', operationId);
  if (saved) return replayDeleteReceipt(saved, requestHash);

  const idsJson = JSON.stringify(ids);
  const now = new Date().toISOString();
  const statements = [
    db
      .prepare(
        `INSERT INTO operation_receipts
          (user_id,kind,operation_id,request_hash,result_json,committed_at)
         VALUES (?,'delete',?,?,json_object(
           'operationId',?,
           'deletedIds',json((SELECT json_group_array(j.value) FROM json_each(?) j
             WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.id=j.value AND t.user_id=?))),
           'unavailableIds',json((SELECT json_group_array(j.value) FROM json_each(?) j
             WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id=j.value AND t.user_id=?)))
         ),?)`,
      )
      .bind(
        userId,
        operationId,
        requestHash,
        operationId,
        idsJson,
        userId,
        idsJson,
        userId,
        now,
      ),
    db
      .prepare(
        `DELETE FROM transaction_reviews
         WHERE user_id=? AND transaction_id IN (
           SELECT t.id FROM transactions t JOIN json_each(?) j ON j.value=t.id
           WHERE t.user_id=?
         )`,
      )
      .bind(userId, idsJson, userId),
    db
      .prepare(
        `DELETE FROM transactions
         WHERE user_id=? AND id IN (SELECT value FROM json_each(?))`,
      )
      .bind(userId, idsJson),
    db
      .prepare(
        `INSERT INTO categorization_contexts (user_id,revision)
         SELECT ?,1 FROM operation_receipts
         WHERE user_id=? AND kind='delete' AND operation_id=?
           AND json_array_length(json_extract(result_json,'$.deletedIds'))>0
         ON CONFLICT(user_id) DO UPDATE SET revision=revision+1`,
      )
      .bind(userId, userId, operationId),
  ];

  try {
    await db.batch(statements);
  } catch (error) {
    const competing = await readReceipt(db, userId, 'delete', operationId);
    if (competing) return replayDeleteReceipt(competing, requestHash);
    throw error;
  }
  const committed = await readReceipt(db, userId, 'delete', operationId);
  if (!committed)
    throw new AppError(
      'The deletion could not be committed. Refresh and try again.',
      409,
    );
  return {
    ...(JSON.parse(committed.result_json) as DeleteReceiptResult),
    replayed: false,
  };
}
