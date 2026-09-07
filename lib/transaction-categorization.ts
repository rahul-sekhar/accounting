import { sha256, validOperationId } from './imports.ts';

export const MAX_CATEGORIZE_IDS = 60;

export function parseCategorizeRequest(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid request body.');
  const input = value as Record<string, unknown>;
  if (!validOperationId(input.operationId))
    throw new Error('A valid categorization operation ID is required.');
  if (
    !Array.isArray(input.ids) ||
    input.ids.length < 1 ||
    input.ids.length > MAX_CATEGORIZE_IDS ||
    input.ids.some((id) => typeof id !== 'string' || !id || id.length > 100) ||
    new Set(input.ids).size !== input.ids.length
  )
    throw new Error(
      `Select between 1 and ${MAX_CATEGORIZE_IDS} unique transactions.`,
    );
  return {
    operationId: input.operationId as string,
    ids: [...(input.ids as string[])].sort(),
  };
}

export function categorizeRequestKey(ids: readonly string[]) {
  return JSON.stringify({ ids: [...ids].sort() });
}

export async function categorizeRequestHash(ids: readonly string[]) {
  return sha256(categorizeRequestKey(ids));
}

export function isCategorizationEligible(transaction: {
  source: string;
  has_review: boolean;
}) {
  return (
    (transaction.source === 'none' || transaction.source === 'ai') &&
    !transaction.has_review
  );
}

export function categorizeBatches(
  ids: readonly string[],
  maximum = MAX_CATEGORIZE_IDS,
) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > MAX_CATEGORIZE_IDS)
    throw new Error(`Batch size must be between 1 and ${MAX_CATEGORIZE_IDS}.`);
  const batches: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += maximum)
    batches.push(ids.slice(offset, offset + maximum));
  return batches;
}

export type CategorizeProgress = {
  status: 'running' | 'completed' | 'stopped' | 'failed';
  total: number;
  processed: number;
  categorized: number;
  protected: number;
  unavailable: number;
  remaining: string[];
  error?: string;
};

export function beginCategorizeProgress(
  ids: readonly string[],
): CategorizeProgress {
  return {
    status: 'running',
    total: ids.length,
    processed: 0,
    categorized: 0,
    protected: 0,
    unavailable: 0,
    remaining: [...ids],
  };
}

export function commitCategorizeBatch(
  progress: CategorizeProgress,
  batchIds: readonly string[],
  result: {
    categorizedIds: readonly string[];
    protectedIds: readonly string[];
    unavailableIds: readonly string[];
  },
): CategorizeProgress {
  const outcomes = [
    ...result.categorizedIds,
    ...result.protectedIds,
    ...result.unavailableIds,
  ];
  if (
    outcomes.length !== batchIds.length ||
    new Set(outcomes).size !== outcomes.length ||
    outcomes.some((id) => !batchIds.includes(id))
  )
    throw new Error(
      'The categorization result was incomplete. Refresh and retry.',
    );
  const committed = new Set(batchIds);
  const remaining = progress.remaining.filter((id) => !committed.has(id));
  return {
    status: remaining.length ? 'running' : 'completed',
    total: progress.total,
    processed: progress.processed + batchIds.length,
    categorized: progress.categorized + result.categorizedIds.length,
    protected: progress.protected + result.protectedIds.length,
    unavailable: progress.unavailable + result.unavailableIds.length,
    remaining,
  };
}

export function haltCategorizeProgress(
  progress: CategorizeProgress,
  status: 'stopped' | 'failed',
  error?: string,
): CategorizeProgress {
  return { ...progress, status, ...(error ? { error } : {}) };
}
