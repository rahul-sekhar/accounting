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
