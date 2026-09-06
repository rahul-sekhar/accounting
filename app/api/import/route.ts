import { getDb } from '@/db';
import { parseCsv, mapTransactions, type Mapping } from '@/lib/banking';
import {
  identity,
  json,
  failure,
  body,
  AppError,
  textValue,
} from '@/lib/server';
export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const b = await body(request);
    const db = getDb();
    const csv = parseCsv(textValue(b.csv, 5_000_000));
    const m = b.mapping as Mapping;
    if (
      !m ||
      !['signed', 'split'].includes(m.mode) ||
      !['normal', 'reverse'].includes(m.sign) ||
      !['YMD', 'MDY', 'DMY'].includes(m.dateFormat)
    )
      throw new AppError('Check the column mapping.');
    const mapped = mapTransactions(csv, m);
    if (mapped.errors.length)
      throw new AppError(mapped.errors.slice(0, 4).join(' '));
    if (!mapped.transactions.length)
      throw new AppError('No valid transactions found.');
    const now = new Date().toISOString(),
      importId = crypto.randomUUID();
    let accountId: string;
    const statements: D1PreparedStatement[] = [];
    if (b.accountId) {
      accountId = textValue(b.accountId);
      const account = await db
        .prepare('SELECT id,currency FROM accounts WHERE id=? AND user_id=?')
        .bind(accountId, user.userId)
        .first<{ id: string; currency: string }>();
      if (!account) throw new AppError('Account not found.', 404);
      b.account = { currency: account.currency };
    } else {
      const a = b.account;
      if (
        !a ||
        !['Scotiabank', 'Wealthsimple'].includes(a.bank) ||
        !['Chequing', 'Savings', 'Credit card', 'Investment'].includes(
          a.type,
        ) ||
        !['CAD', 'USD'].includes(a.currency)
      )
        throw new AppError('Check the account details.');
      accountId = crypto.randomUUID();
      statements.push(
        db
          .prepare(
            'INSERT INTO accounts (id,user_id,bank,name,type,currency,created_at) VALUES (?,?,?,?,?,?,?)',
          )
          .bind(
            accountId,
            user.userId,
            a.bank,
            textValue(a.name, 80),
            a.type,
            a.currency,
            now,
          ),
      );
    }
    const currencyColumn = csv.headers.findIndex((h) => /^currency$/i.test(h));
    if (
      currencyColumn >= 0 &&
      csv.rows.some(
        (r) =>
          r[currencyColumn] &&
          r[currencyColumn].toUpperCase() !== b.account.currency,
      )
    )
      throw new AppError(
        'This CSV contains a different currency. Split it into one file per currency.',
      );
    const rows = await Promise.all(
      mapped.transactions.map(async (t) => {
        const key = JSON.stringify([
          t.date,
          t.description.toLowerCase().replace(/\s+/g, ' '),
          t.amount,
          t.occurrence,
        ]);
        const hash = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(key),
            ),
          ),
        )
          .map((n) => n.toString(16).padStart(2, '0'))
          .join('');
        return [
          crypto.randomUUID(),
          user.userId,
          accountId,
          t.date,
          t.description,
          t.subDescription,
          t.amount,
          hash,
          importId,
          now,
        ];
      }),
    );
    for (let i = 0; i < rows.length; i += 10) {
      const part = rows.slice(i, i + 10);
      statements.push(
        db
          .prepare(
            'INSERT INTO transactions (id,user_id,account_id,date,description,sub_description,amount,fingerprint,import_id,created_at) VALUES ' +
              part.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',') +
              " ON CONFLICT(user_id,account_id,fingerprint) DO UPDATE SET sub_description=excluded.sub_description WHERE transactions.sub_description='' AND excluded.sub_description!=''",
          )
          .bind(...part.flat()),
      );
    }
    statements.push(
      db
        .prepare(
          'INSERT INTO imports (id,user_id,account_id,filename,added,skipped,created_at) SELECT ?,?,?,?,COUNT(*),?-COUNT(*),? FROM transactions WHERE import_id=? AND user_id=?',
        )
        .bind(
          importId,
          user.userId,
          accountId,
          textValue(b.filename, 240),
          rows.length,
          now,
          importId,
          user.userId,
        ),
    );
    await db.batch(statements);
    const result = await db
      .prepare('SELECT added,skipped FROM imports WHERE id=? AND user_id=?')
      .bind(importId, user.userId)
      .first();
    return json({ ...result, accountId });
  } catch (e) {
    if (
      e instanceof Error &&
      !(e instanceof AppError) &&
      /CSV|Row |rows|column/i.test(e.message)
    )
      return json({ error: e.message }, 400);
    return failure(e);
  }
}
