import { sha256, validOperationId } from './imports.ts';

export const MAX_DELETE_IDS = 50;

export function parseDeleteRequest(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid request body.');
  const input = value as Record<string, unknown>;
  if (!validOperationId(input.operationId))
    throw new Error('A valid delete operation ID is required.');
  if (
    !Array.isArray(input.ids) ||
    input.ids.length < 1 ||
    input.ids.length > MAX_DELETE_IDS ||
    input.ids.some((id) => typeof id !== 'string' || !id || id.length > 100) ||
    new Set(input.ids).size !== input.ids.length
  )
    throw new Error(
      `Select between 1 and ${MAX_DELETE_IDS} unique transactions.`,
    );
  return {
    operationId: input.operationId,
    ids: [...(input.ids as string[])].sort(),
  };
}

export function deleteRequestKey(ids: readonly string[]) {
  return JSON.stringify({ ids: [...ids].sort() });
}

export async function deleteRequestHash(ids: readonly string[]) {
  return sha256(deleteRequestKey(ids));
}
