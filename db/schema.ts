import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core';
export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    bank: text('bank').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    currency: text('currency').notNull(),
    balance: integer('balance'),
    balanceDate: text('balance_date'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('accounts_owner').on(t.userId)],
);
export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    description: text('description').notNull(),
    amount: integer('amount').notNull(),
    fingerprint: text('fingerprint').notNull(),
    importId: text('import_id').notNull(),
    category: text('category').notNull().default('Uncategorized'),
    source: text('source').notNull().default('none'),
    confidence: text('confidence'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('transactions_dedupe').on(t.userId, t.accountId, t.fingerprint),
    index('transactions_owner_date').on(t.userId, t.date),
  ],
);
export const imports = sqliteTable(
  'imports',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    added: integer('added').notNull(),
    skipped: integer('skipped').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('imports_owner').on(t.userId)],
);
