import { getDb } from '@/db';
import { deleteTransactions } from '@/lib/operations-server';
import {
  deleteRequestHash,
  parseDeleteRequest,
} from '@/lib/transaction-deletion';
import { AppError, body, failure, identity, json } from '@/lib/server';

export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const value = await body(request);
    let parsed;
    try {
      parsed = parseDeleteRequest(value);
    } catch (error) {
      throw new AppError((error as Error).message);
    }
    const requestHash = await deleteRequestHash(parsed.ids);
    return json(
      await deleteTransactions(
        getDb(),
        user.userId,
        parsed.operationId,
        parsed.ids,
        requestHash,
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
