import type { AccountInput } from './accounts';

type AccountRow = AccountInput & {
  id: string;
  archived: number;
};

export class AccountStoreError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const ACCOUNT_COLUMNS = 'id,bank,name,type,currency,archived';
const HISTORY_GUARD = `
  NOT EXISTS (SELECT 1 FROM transactions WHERE transactions.account_id=accounts.id AND transactions.user_id=accounts.user_id)
  AND NOT EXISTS (SELECT 1 FROM imports WHERE imports.account_id=accounts.id AND imports.user_id=accounts.user_id)
  AND NOT EXISTS (SELECT 1 FROM transaction_reviews WHERE transaction_reviews.account_id=accounts.id AND transaction_reviews.user_id=accounts.user_id)
  AND NOT EXISTS (SELECT 1 FROM transaction_review_events WHERE transaction_review_events.account_id=accounts.id AND transaction_review_events.user_id=accounts.user_id)
`;

async function findAccount(db: D1Database, id: string, userId: string) {
  return db
    .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id=? AND user_id=?`)
    .bind(id, userId)
    .first<AccountRow>();
}

function responseAccount(account: AccountRow) {
  return { ...account, archived: Boolean(account.archived) };
}

export async function createAccount(
  db: D1Database,
  userId: string,
  input: AccountInput,
) {
  const id = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO accounts (id,user_id,bank,name,type,currency,archived,created_at) VALUES (?,?,?,?,?,?,0,?)',
    )
    .bind(
      id,
      userId,
      input.bank,
      input.name,
      input.type,
      input.currency,
      new Date().toISOString(),
    )
    .run();
  const account = await findAccount(db, id, userId);
  if (!account) throw new Error('Created account could not be read.');
  return responseAccount(account);
}

export async function setAccountArchived(
  db: D1Database,
  userId: string,
  id: string,
  archived: boolean,
) {
  await db
    .prepare('UPDATE accounts SET archived=? WHERE id=? AND user_id=?')
    .bind(archived ? 1 : 0, id, userId)
    .run();
  const account = await findAccount(db, id, userId);
  if (!account) throw new AccountStoreError('Account not found.', 404);
  return responseAccount(account);
}

export async function updateAccount(
  db: D1Database,
  userId: string,
  id: string,
  input: AccountInput,
) {
  const result = await db
    .prepare(
      `UPDATE accounts SET bank=?,name=?,type=?,currency=?
       WHERE id=? AND user_id=?
       AND ((type=? AND currency=?) OR (${HISTORY_GUARD}))`,
    )
    .bind(
      input.bank,
      input.name,
      input.type,
      input.currency,
      id,
      userId,
      input.type,
      input.currency,
    )
    .run();
  if (!result.meta.changes) {
    const existing = await findAccount(db, id, userId);
    if (!existing) throw new AccountStoreError('Account not found.', 404);
    if (existing.type !== input.type || existing.currency !== input.currency)
      throw new AccountStoreError(
        'Account type and currency cannot change after account history exists.',
        409,
      );
  }
  const account = await findAccount(db, id, userId);
  if (!account) throw new AccountStoreError('Account not found.', 404);
  return responseAccount(account);
}

export async function deleteAccount(
  db: D1Database,
  userId: string,
  id: string,
) {
  const result = await db
    .prepare(
      `DELETE FROM accounts WHERE id=? AND user_id=? AND (${HISTORY_GUARD})`,
    )
    .bind(id, userId)
    .run();
  if (!result.meta.changes) {
    const existing = await findAccount(db, id, userId);
    if (!existing) throw new AccountStoreError('Account not found.', 404);
    throw new AccountStoreError(
      'This account has history and cannot be deleted. Archive it instead.',
      409,
    );
  }
}
