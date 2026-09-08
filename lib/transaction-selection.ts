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
