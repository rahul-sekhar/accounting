import type { CategoryDefinition } from './banking';

export const MEMORY_NORMALIZATION_VERSION = 1;
export const MAX_MEMORY_BYTES = 16_000;

export type ReviewMemoryRow = {
  transactionId: string;
  revision?: number;
  categoryId: string;
  memoryEnabled: boolean | number;
  reviewedAt: string | null;
  description: string;
  subDescription: string;
  amount: number;
  currency: string;
  accountId: string;
  accountType: string;
  origin?: string;
};

export type MemoryAlternative = {
  memoryId: string;
  categoryId: string;
  categoryName: string;
  categoryKind: string;
  reviewedTransactionCount: number;
  latestReviewAt: string | null;
  amountRange: { min: number; max: number };
  transactionIds: string[];
};

export type MemoryCluster = {
  clusterId: string;
  normalizationVersion: number;
  normalizedDescription: string;
  normalizedSubDescription: string;
  representativeDescription: string;
  representativeSubDescription: string;
  accountId: string;
  accountType: string;
  currency: string;
  direction: 'inflow' | 'outflow' | 'zero';
  alternatives: MemoryAlternative[];
  conflicting: boolean;
};

export type MemoryTarget = {
  description: string;
  subDescription: string;
  amount: number;
  currency: string;
  accountId: string;
  accountType: string;
};

export function normalizeReviewText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-CA').trim().replace(/\s+/gu, ' ');
}

export function transactionDirection(amount: number) {
  return amount > 0 ? ('inflow' as const) : amount < 0 ? ('outflow' as const) : ('zero' as const);
}

function hash(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const byte of new TextEncoder().encode(value)) {
    first = Math.imul(first ^ byte, 0x01000193) >>> 0;
    second = Math.imul(second ^ byte, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(36).padStart(7, '0')}${second.toString(36).padStart(7, '0')}`;
}

function contextKey(row: ReviewMemoryRow) {
  return JSON.stringify([
    MEMORY_NORMALIZATION_VERSION,
    normalizeReviewText(row.description),
    normalizeReviewText(row.subDescription),
    row.accountId,
    normalizeReviewText(row.accountType),
    row.currency.toUpperCase(),
    transactionDirection(row.amount),
  ]);
}

export function buildReviewMemory(
  rows: ReviewMemoryRow[],
  categories: CategoryDefinition[],
): MemoryCluster[] {
  const active = new Map(
    categories.filter((category) => !category.archived && category.id !== 'Uncategorized').map((category) => [category.id, category]),
  );
  const contexts = new Map<string, ReviewMemoryRow[]>();
  const latestByTransaction = new Map<string, ReviewMemoryRow>();
  for (const row of rows) {
    const previous = latestByTransaction.get(row.transactionId);
    if (
      !previous ||
      (row.revision || 0) > (previous.revision || 0) ||
      ((row.revision || 0) === (previous.revision || 0) &&
        (row.reviewedAt || '') >= (previous.reviewedAt || ''))
    )
      latestByTransaction.set(row.transactionId, row);
  }
  for (const row of latestByTransaction.values()) {
    if (!row.memoryEnabled || !active.has(row.categoryId) || row.categoryId === 'Uncategorized') continue;
    const key = contextKey(row);
    const current = contexts.get(key) || [];
    current.push(row);
    contexts.set(key, current);
  }
  return [...contexts.entries()]
    .map(([key, contextRows]) => {
      const first = contextRows[0];
      const byCategory = new Map<string, ReviewMemoryRow[]>();
      for (const row of contextRows) {
        const current = byCategory.get(row.categoryId) || [];
        current.push(row);
        byCategory.set(row.categoryId, current);
      }
      const alternatives = [...byCategory.entries()]
        .map(([categoryId, categoryRows]) => {
          const category = active.get(categoryId)!;
          const dates = categoryRows.map((row) => row.reviewedAt).filter(Boolean) as string[];
          const amounts = categoryRows.map((row) => row.amount);
          return {
            memoryId: `mem_v${MEMORY_NORMALIZATION_VERSION}_${hash(`${key}\0${categoryId}`)}`,
            categoryId,
            categoryName: category.name,
            categoryKind: category.kind,
            reviewedTransactionCount: new Set(categoryRows.map((row) => row.transactionId)).size,
            latestReviewAt: dates.sort().at(-1) || null,
            amountRange: { min: Math.min(...amounts), max: Math.max(...amounts) },
            transactionIds: [...new Set(categoryRows.map((row) => row.transactionId))].sort(),
          };
        })
        .sort((a, b) => a.categoryId.localeCompare(b.categoryId));
      return {
        clusterId: `ctx_v${MEMORY_NORMALIZATION_VERSION}_${hash(key)}`,
        normalizationVersion: MEMORY_NORMALIZATION_VERSION,
        normalizedDescription: normalizeReviewText(first.description),
        normalizedSubDescription: normalizeReviewText(first.subDescription),
        representativeDescription: first.description,
        representativeSubDescription: first.subDescription,
        accountId: first.accountId,
        accountType: first.accountType,
        currency: first.currency.toUpperCase(),
        direction: transactionDirection(first.amount),
        alternatives,
        conflicting: alternatives.length > 1,
      } satisfies MemoryCluster;
    })
    .sort((a, b) => a.clusterId.localeCompare(b.clusterId));
}

export function maskLongReferences(value: string) {
  return value.replace(/\b\d{4,}\b/gu, '[reference]');
}

function tokens(value: string) {
  return new Set(normalizeReviewText(value).match(/[\p{L}\p{N}]{2,}/gu) || []);
}

function scoreCluster(cluster: MemoryCluster, targets: MemoryTarget[]) {
  let best = 0;
  for (const target of targets) {
    const description = normalizeReviewText(target.description);
    const subDescription = normalizeReviewText(target.subDescription);
    const compatible =
      cluster.accountId === target.accountId &&
      normalizeReviewText(cluster.accountType) === normalizeReviewText(target.accountType) &&
      cluster.currency === target.currency.toUpperCase() &&
      cluster.direction === transactionDirection(target.amount);
    if (description === cluster.normalizedDescription && subDescription === cluster.normalizedSubDescription && compatible) best = Math.max(best, 4_000);
    else if (description === cluster.normalizedDescription) best = Math.max(best, 3_000 + (compatible ? 100 : 0));
    else {
      const wanted = tokens(`${target.description} ${target.subDescription}`);
      const available = tokens(`${cluster.normalizedDescription} ${cluster.normalizedSubDescription}`);
      let overlap = 0;
      for (const token of wanted) if (available.has(token)) overlap++;
      best = Math.max(best, overlap * 100 + (compatible ? 10 : 0));
    }
  }
  const support = cluster.alternatives.reduce((sum, item) => sum + item.reviewedTransactionCount, 0);
  const latest = cluster.alternatives.map((item) => item.latestReviewAt || '').sort().at(-1) || '';
  return { best, support, latest };
}

function publicReference(clusters: MemoryCluster[], targets: MemoryTarget[], totalClusters: number, truncated: boolean) {
  const accountIds = [
    ...new Set([
      ...clusters.map((cluster) => cluster.accountId),
      ...targets.map((target) => target.accountId),
    ]),
  ].sort();
  const accountRefs = new Map(accountIds.map((id, index) => [id, `account_${index + 1}`]));
  return {
    normalizationVersion: MEMORY_NORMALIZATION_VERSION,
    coverage: { totalClusters, includedClusters: clusters.length, truncated },
    clusters: clusters.map((cluster) => ({
      id: cluster.clusterId,
      description: maskLongReferences(cluster.representativeDescription),
      subDescription: maskLongReferences(cluster.representativeSubDescription),
      accountRef: accountRefs.get(cluster.accountId),
      accountType: cluster.accountType,
      currency: cluster.currency,
      direction: cluster.direction,
      conflicting: cluster.conflicting,
      alternatives: cluster.alternatives.map(({ transactionIds: _transactionIds, ...alternative }) => alternative),
    })),
  };
}

export function selectReviewMemory(
  clusters: MemoryCluster[],
  targets: MemoryTarget[],
  maxBytes = MAX_MEMORY_BYTES,
) {
  const ranked = [...clusters].sort((a, b) => {
    const left = scoreCluster(a, targets);
    const right = scoreCluster(b, targets);
    return (
      right.best - left.best ||
      right.support - left.support ||
      right.latest.localeCompare(left.latest) ||
      a.clusterId.localeCompare(b.clusterId)
    );
  });
  const included: MemoryCluster[] = [];
  for (const cluster of ranked) {
    const candidate = [...included, cluster];
    const reference = publicReference(candidate, targets, clusters.length, candidate.length < clusters.length);
    if (new TextEncoder().encode(JSON.stringify(reference)).byteLength <= maxBytes) included.push(cluster);
  }
  const reference = publicReference(included, targets, clusters.length, included.length < clusters.length);
  const accountIds = [
    ...new Set([
      ...included.map((cluster) => cluster.accountId),
      ...targets.map((target) => target.accountId),
    ]),
  ].sort();
  return {
    reference,
    serialized: JSON.stringify(reference),
    allowedMemoryIds: new Set(included.flatMap((cluster) => cluster.alternatives.map((item) => item.memoryId))),
    includedClusters: included,
    accountRefs: new Map(accountIds.map((id, index) => [id, `account_${index + 1}`])),
  };
}
