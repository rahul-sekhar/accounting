import { env } from 'cloudflare:workers';
import { getDb } from '@/db';
import { identity, json, failure } from '@/lib/server';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const user = await identity();
    const db = getDb();
    const [accounts, transactions, imports] = await db.batch([
      db
        .prepare(
          'SELECT id,bank,name,type,currency,balance,balance_date FROM accounts WHERE user_id=? ORDER BY created_at',
        )
        .bind(user.userId),
      db
        .prepare(
          'SELECT id,account_id,date,description,amount,category,source,confidence FROM transactions WHERE user_id=? ORDER BY date DESC,id',
        )
        .bind(user.userId),
      db
        .prepare(
          'SELECT id,account_id,filename,added,skipped,created_at FROM imports WHERE user_id=? ORDER BY created_at DESC LIMIT 20',
        )
        .bind(user.userId),
    ]);
    return json({
      accounts: accounts.results,
      transactions: transactions.results,
      imports: imports.results,
      aiReady: Boolean(env.OPENAI_API_KEY),
      user: user.displayName,
    });
  } catch (e) {
    return failure(e);
  }
}
