export type TransactionSelection = ReadonlySet<string>;

export function toggleTransaction(
  selection: TransactionSelection,
  id: string,
  selected: boolean,
) {
  const next = new Set(selection);
  if (selected) next.add(id);
  else next.delete(id);
  return next;
}

export function toggleTransactionPage(
  selection: TransactionSelection,
  pageIds: readonly string[],
  selected: boolean,
) {
  const next = new Set(selection);
  for (const id of pageIds) {
    if (selected) next.add(id);
    else next.delete(id);
  }
  return next;
}

export function captureMatchingTransactions(ids: readonly string[]) {
  return new Set(ids);
}

export function intersectTransactionSelection(
  selection: TransactionSelection,
  matchingIds: readonly string[],
) {
  const matching = new Set(matchingIds);
  const next = new Set([...selection].filter((id) => matching.has(id)));
  return { selection: next, removed: selection.size - next.size };
}

export function pageSelectionState(
  selection: TransactionSelection,
  pageIds: readonly string[],
) {
  const selected = pageIds.filter((id) => selection.has(id)).length;
  return {
    selected,
    checked: pageIds.length > 0 && selected === pageIds.length,
    indeterminate: selected > 0 && selected < pageIds.length,
  };
}

export function deleteBatches(ids: readonly string[], maximum = 50) {
  if (!Number.isInteger(maximum) || maximum < 1)
    throw new Error('Batch size must be a positive integer.');
  const captured = [...ids];
  const batches: string[][] = [];
  for (let offset = 0; offset < captured.length; offset += maximum)
    batches.push(captured.slice(offset, offset + maximum));
  return batches;
}

export type DeleteProgress = {
  status: 'running' | 'completed' | 'stopped' | 'failed';
  total: number;
  processed: number;
  deleted: number;
  unavailable: number;
  remaining: string[];
  error?: string;
};

export function beginDeleteProgress(ids: readonly string[]): DeleteProgress {
  return {
    status: 'running',
    total: ids.length,
    processed: 0,
    deleted: 0,
    unavailable: 0,
    remaining: [...ids],
  };
}

export function commitDeleteBatch(
  progress: DeleteProgress,
  batchIds: readonly string[],
  result: { deletedIds: readonly string[]; unavailableIds: readonly string[] },
): DeleteProgress {
  const committed = new Set(batchIds);
  const remaining = progress.remaining.filter((id) => !committed.has(id));
  return {
    status: remaining.length ? 'running' : 'completed',
    total: progress.total,
    processed: progress.processed + batchIds.length,
    deleted: progress.deleted + result.deletedIds.length,
    unavailable: progress.unavailable + result.unavailableIds.length,
    remaining,
  };
}

export function haltDeleteProgress(
  progress: DeleteProgress,
  status: 'stopped' | 'failed',
  error?: string,
): DeleteProgress {
  return { ...progress, status, ...(error ? { error } : {}) };
}
