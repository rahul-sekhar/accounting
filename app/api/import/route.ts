import { getDb } from '@/db';
import { parseCsv, mapTransactions, type Mapping } from '@/lib/banking';
import { AccountInputError, parseAccountInput } from '@/lib/accounts';
import {
  importRequestKey,
  normalizeMapping,
  sha256,
  transactionFingerprint,
  validOperationId,
} from '@/lib/imports';
import { identity, json, failure, body, AppError, textValue } from '@/lib/server';

type ReceiptResult = {
  importId: string;
  accountId: string;
  added: number;
  skipped: number;
  enriched: number;
  total: number;
  currency: string;
};

async function receipt(db: D1Database, userId: string, operationId: string) {
  return db
    .prepare("SELECT request_hash,result_json FROM operation_receipts WHERE user_id=? AND kind='import' AND operation_id=?")
    .bind(userId, operationId)
    .first<{ request_hash: string; result_json: string }>();
}

function replayResponse(saved: { request_hash: string; result_json: string }, requestHash: string) {
  if (saved.request_hash !== requestHash)
    return json(
      { error: 'This import operation ID was already used for different data.', code: 'operation_conflict' },
      409,
    );
  return json({ ...(JSON.parse(saved.result_json) as ReceiptResult), replayed: true });
}

function checkedMapping(value: unknown) {
  const mapping = value as Mapping;
  if (
    !mapping ||
    typeof mapping !== 'object' ||
    !['signed', 'split'].includes(mapping.mode) ||
    !['normal', 'reverse'].includes(mapping.sign) ||
    !['YMD', 'MDY', 'DMY'].includes(mapping.dateFormat)
  )
    throw new AppError('Check the column mapping.');
  return normalizeMapping(mapping);
}

export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const value = await body(request);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new AppError('Invalid request body.');
    const b = value as Record<string, unknown>;
    if (!validOperationId(b.operationId))
      throw new AppError('A valid import operation ID is required.');
    const operationId = b.operationId;
    const csvText = textValue(b.csv, 5_000_000);
    const filename = textValue(b.filename, 240);
    const mapping = checkedMapping(b.mapping);
    const accountIdInput = b.accountId ? textValue(b.accountId) : null;
    let accountInput;
    if (!accountIdInput) {
      try {
        accountInput = parseAccountInput(b.account);
      } catch (error) {
        if (error instanceof AccountInputError) throw new AppError(error.message);
        throw error;
      }
    }
    const requestHash = await sha256(
      importRequestKey({ csv: csvText, filename, mapping, accountId: accountIdInput, account: accountInput }),
    );
    const db = getDb();
    const saved = await receipt(db, user.userId, operationId);
    if (saved) return replayResponse(saved, requestHash);

    const csv = parseCsv(csvText);
    const mapped = mapTransactions(csv, mapping);
    if (mapped.errors.length) throw new AppError(mapped.errors.slice(0, 4).join(' '));
    if (!mapped.transactions.length) throw new AppError('No valid transactions found.');

    const now = new Date().toISOString();
    const importId = crypto.randomUUID();
    const accountId = accountIdInput || crypto.randomUUID();
    let accountCurrency: string;
    const statements: D1PreparedStatement[] = [];
    if (accountIdInput) {
      const account = await db
        .prepare('SELECT currency,archived FROM accounts WHERE id=? AND user_id=?')
        .bind(accountId, user.userId)
        .first<{ currency: string; archived: number }>();
      if (!account) throw new AppError('Account not found.', 404);
      if (account.archived) throw new AppError('Restore this account before importing into it.', 409);
      accountCurrency = account.currency;
    } else {
      accountCurrency = accountInput!.currency;
      statements.push(
        db
          .prepare('INSERT INTO accounts (id,user_id,bank,name,type,currency,archived,created_at) VALUES (?,?,?,?,?,?,0,?)')
          .bind(accountId, user.userId, accountInput!.bank, accountInput!.name, accountInput!.type, accountInput!.currency, now),
      );
    }
    const currencyColumn = csv.headers.findIndex((header) => /^currency$/i.test(header));
    if (
      currencyColumn >= 0 &&
      csv.rows.some((row) => row[currencyColumn] && row[currencyColumn].toUpperCase() !== accountCurrency)
    )
      throw new AppError('This CSV contains a different currency. Split it into one file per currency.');

    const rows = await Promise.all(
      mapped.transactions.map(async (transaction, index) => ({
        rowOrdinal: index + 1,
        occurrence: transaction.occurrence,
        date: transaction.date,
        description: transaction.description,
        subDescription: transaction.subDescription,
        amount: transaction.amount,
        fingerprint: await transactionFingerprint(transaction),
        transactionId: crypto.randomUUID(),
      })),
    );

    statements.push(
      db
        .prepare(`INSERT INTO imports (id,user_id,account_id,filename,added,skipped,enriched,report_version,created_at)
          SELECT ?,?,?,?,0,0,0,1,? FROM accounts
          WHERE id=? AND user_id=? AND archived=0 AND currency=?`)
        .bind(importId, user.userId, accountId, filename, now, accountId, user.userId, accountCurrency),
    );

    for (let offset = 0; offset < rows.length; offset += 50) {
      const part = rows.slice(offset, offset + 50);
      const firstOrdinal = part[0].rowOrdinal;
      const lastOrdinal = part[part.length - 1].rowOrdinal;
      statements.push(
        db
          .prepare(`INSERT INTO import_row_outcomes
            (user_id,import_id,account_id,row_ordinal,occurrence,date,description,sub_description,amount,fingerprint,outcome,transaction_id,action_detail)
            SELECT ?,?,?,CAST(json_extract(j.value,'$.rowOrdinal') AS INTEGER),
              CAST(json_extract(j.value,'$.occurrence') AS INTEGER),json_extract(j.value,'$.date'),
              json_extract(j.value,'$.description'),json_extract(j.value,'$.subDescription'),
              CAST(json_extract(j.value,'$.amount') AS INTEGER),json_extract(j.value,'$.fingerprint'),
              CASE WHEN t.id IS NULL THEN 'added'
                WHEN t.sub_description='' AND json_extract(j.value,'$.subDescription')!='' THEN 'duplicate_enriched'
                ELSE 'duplicate_skipped' END,
              COALESCE(t.id,json_extract(j.value,'$.transactionId')),
              CASE WHEN t.id IS NULL THEN 'Added as a new transaction'
                WHEN t.sub_description='' AND json_extract(j.value,'$.subDescription')!='' THEN 'Filled the missing sub-description'
                ELSE 'Skipped; the transaction was already present' END
            FROM json_each(?) j
            LEFT JOIN transactions t ON t.user_id=? AND t.account_id=?
              AND t.fingerprint=json_extract(j.value,'$.fingerprint')`)
          .bind(user.userId, importId, accountId, JSON.stringify(part), user.userId, accountId),
        db
          .prepare(`INSERT INTO transactions
            (id,user_id,account_id,date,description,sub_description,amount,fingerprint,import_id,created_at)
            SELECT transaction_id,user_id,account_id,date,description,sub_description,amount,fingerprint,import_id,?
            FROM import_row_outcomes
            WHERE user_id=? AND import_id=? AND row_ordinal BETWEEN ? AND ? AND outcome='added'`)
          .bind(now, user.userId, importId, firstOrdinal, lastOrdinal),
        db
          .prepare(`UPDATE transactions SET
              sub_description=(SELECT o.sub_description FROM import_row_outcomes o
                WHERE o.user_id=transactions.user_id AND o.import_id=?
                  AND o.transaction_id=transactions.id AND o.outcome='duplicate_enriched'),
              category_revision=category_revision+1
            WHERE user_id=? AND sub_description=''
              AND id IN (SELECT transaction_id FROM import_row_outcomes
                WHERE user_id=? AND import_id=? AND row_ordinal BETWEEN ? AND ?
                  AND outcome='duplicate_enriched')`)
          .bind(importId, user.userId, user.userId, importId, firstOrdinal, lastOrdinal),
      );
    }
    statements.push(
      db
        .prepare(`UPDATE imports SET
            added=(SELECT COUNT(*) FROM import_row_outcomes WHERE user_id=? AND import_id=? AND outcome='added'),
            skipped=(SELECT COUNT(*) FROM import_row_outcomes WHERE user_id=? AND import_id=? AND outcome!='added'),
            enriched=(SELECT COUNT(*) FROM import_row_outcomes WHERE user_id=? AND import_id=? AND outcome='duplicate_enriched')
          WHERE id=? AND user_id=?`)
        .bind(user.userId, importId, user.userId, importId, user.userId, importId, importId, user.userId),
      db
        .prepare(`INSERT INTO operation_receipts (user_id,kind,operation_id,request_hash,result_json,committed_at)
          SELECT ?,'import',?,?,json_object('importId',id,'accountId',account_id,'added',added,
            'skipped',skipped,'enriched',enriched,'total',added+skipped,'currency',?),?
          FROM imports WHERE id=? AND user_id=?`)
        .bind(user.userId, operationId, requestHash, accountCurrency, now, importId, user.userId),
    );

    try {
      await db.batch(statements);
    } catch (error) {
      const competing = await receipt(db, user.userId, operationId);
      if (competing) return replayResponse(competing, requestHash);
      throw error;
    }
    const committed = await receipt(db, user.userId, operationId);
    if (!committed)
      throw new AppError('The account changed or the import could not be committed. Refresh and try again.', 409);
    return json({ ...(JSON.parse(committed.result_json) as ReceiptResult), replayed: false });
  } catch (error) {
    if (error instanceof Error && !(error instanceof AppError) && /CSV|Row |rows|column/i.test(error.message))
      return json({ error: error.message }, 400);
    return failure(error);
  }
}
