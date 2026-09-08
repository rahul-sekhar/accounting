import { env } from 'cloudflare:workers';
import { getDb } from '@/db';
import { categorizeTransactions } from '@/lib/categorization-server';
import { getCategories } from '@/lib/categories-server';
import {
  categorizeRequestHash,
  parseCategorizeRequest,
} from '@/lib/transaction-categorization';
import { identity, json, failure, body, AppError } from '@/lib/server';
import { getContextRevision, loadReviewRows } from '@/lib/reviews-server';

export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const value = await body(request);
    let input;
    try {
      input = parseCategorizeRequest(value);
    } catch (error) {
      throw new AppError((error as Error).message);
    }
    return json(
      await categorizeTransactions({
        db: getDb(),
        userId: user.userId,
        operationId: input.operationId,
        ids: input.ids,
        requestHash: await categorizeRequestHash(input.ids),
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL,
        transport: fetch,
        getCategories: (userId, db) => getCategories(userId, db),
        getContextRevision: (userId, db) => getContextRevision(userId, db),
        loadReviewRows: (userId, db) => loadReviewRows(userId, 500, db),
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
