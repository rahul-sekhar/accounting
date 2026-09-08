import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
  primaryKey,
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
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
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
    subDescription: text('sub_description').notNull().default(''),
    amount: integer('amount').notNull(),
    fingerprint: text('fingerprint').notNull(),
    importId: text('import_id').notNull(),
    category: text('category').notNull().default('Uncategorized'),
    source: text('source').notNull().default('none'),
    confidence: text('confidence'),
    categoryRevision: integer('category_revision').notNull().default(0),
    categorizationEvidence: text('categorization_evidence'),
    spreadStartMonth: text('spread_start_month'),
    spreadMonthCount: integer('spread_month_count'),
    spreadRevision: integer('spread_revision').notNull().default(0),
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
    enriched: integer('enriched').notNull().default(0),
    reportVersion: integer('report_version'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('imports_owner').on(t.userId)],
);

export const importRowOutcomes = sqliteTable(
  'import_row_outcomes',
  {
    userId: text('user_id').notNull(),
    importId: text('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    rowOrdinal: integer('row_ordinal').notNull(),
    occurrence: integer('occurrence').notNull(),
    date: text('date').notNull(),
    description: text('description').notNull(),
    subDescription: text('sub_description').notNull(),
    amount: integer('amount').notNull(),
    fingerprint: text('fingerprint').notNull(),
    outcome: text('outcome').notNull(),
    transactionId: text('transaction_id').notNull(),
    actionDetail: text('action_detail').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.importId, t.rowOrdinal] }),
    index('import_outcomes_owner_import_outcome').on(
      t.userId,
      t.importId,
      t.outcome,
      t.rowOrdinal,
    ),
    index('import_outcomes_owner_account').on(t.userId, t.accountId),
  ],
);

export const operationReceipts = sqliteTable(
  'operation_receipts',
  {
    userId: text('user_id').notNull(),
    kind: text('kind').notNull(),
    operationId: text('operation_id').notNull(),
    requestHash: text('request_hash').notNull(),
    resultJson: text('result_json').notNull(),
    committedAt: text('committed_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.kind, t.operationId] }),
    index('operation_receipts_owner_committed').on(t.userId, t.committedAt),
  ],
);

export const categoryDefinitions = sqliteTable(
  'category_definitions',
  {
    userId: text('user_id').notNull(),
    id: text('id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

export const transactionReviewEvents = sqliteTable(
  'transaction_review_events',
  {
    operationId: text('operation_id').notNull(),
    userId: text('user_id').notNull(),
    transactionId: text('transaction_id').notNull(),
    action: text('action').notNull(),
    previousCategoryId: text('previous_category_id'),
    resultingCategoryId: text('resulting_category_id').notNull(),
    previousSource: text('previous_source').notNull(),
    previousConfidence: text('previous_confidence'),
    previousMemoryEnabled: integer('previous_memory_enabled', {
      mode: 'boolean',
    }),
    resultingMemoryEnabled: integer('resulting_memory_enabled', {
      mode: 'boolean',
    }).notNull(),
    description: text('description').notNull(),
    subDescription: text('sub_description').notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    accountId: text('account_id').notNull(),
    accountType: text('account_type').notNull(),
    recordedAt: text('recorded_at').notNull(),
    reviewedAt: text('reviewed_at'),
    resultingRevision: integer('resulting_revision').notNull(),
    origin: text('origin').notNull(),
    inputHash: text('input_hash').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.operationId] }),
    index('review_events_owner_transaction').on(
      t.userId,
      t.transactionId,
      t.resultingRevision,
    ),
  ],
);

export const transactionReviews = sqliteTable(
  'transaction_reviews',
  {
    userId: text('user_id').notNull(),
    transactionId: text('transaction_id').notNull(),
    latestOperationId: text('latest_operation_id').notNull(),
    categoryId: text('category_id').notNull(),
    memoryEnabled: integer('memory_enabled', { mode: 'boolean' })
      .notNull()
      .default(true),
    revision: integer('revision').notNull(),
    reviewedAt: text('reviewed_at'),
    description: text('description').notNull(),
    subDescription: text('sub_description').notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    accountId: text('account_id').notNull(),
    accountType: text('account_type').notNull(),
    origin: text('origin').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.transactionId] }),
    index('transaction_reviews_owner_memory').on(t.userId, t.memoryEnabled),
  ],
);

export const categorizationContexts = sqliteTable('categorization_contexts', {
  userId: text('user_id').primaryKey(),
  revision: integer('revision').notNull().default(0),
});
