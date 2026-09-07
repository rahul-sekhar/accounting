import { env } from 'cloudflare:workers';
import { getDb } from '@/db';
import { getCategories } from '@/lib/categories-server';
import { identity, json, failure } from '@/lib/server';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const user = await identity();
    const db = getDb();
    const [accounts, transactions, imports] = await db.batch([
      db
        .prepare(
          'SELECT id,bank,name,type,currency,archived FROM accounts WHERE user_id=? ORDER BY archived,created_at',
        )
        .bind(user.userId),
      db
        .prepare(
          'SELECT t.id,t.account_id,t.import_id,t.date,t.description,t.sub_description,t.amount,t.category,t.source,t.confidence,t.category_revision,t.categorization_evidence,r.reviewed_at,r.memory_enabled FROM transactions t LEFT JOIN transaction_reviews r ON r.user_id=t.user_id AND r.transaction_id=t.id WHERE t.user_id=? ORDER BY t.date DESC,t.id',
        )
        .bind(user.userId),
      db
        .prepare(
          'SELECT id,account_id,filename,added,skipped,enriched,report_version,created_at FROM imports WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 20',
        )
        .bind(user.userId),
    ]);
    return json({
      accounts: (accounts.results as Array<Record<string, unknown>>).map(
        (account) => ({
          ...account,
          archived: Boolean(account.archived),
        }),
      ),
      transactions: transactions.results,
      imports: imports.results,
      categories: await getCategories(user.userId),
      aiReady: Boolean(env.OPENAI_API_KEY),
      user: user.displayName,
    });
  } catch (e) {
    return failure(e);
  }
}
