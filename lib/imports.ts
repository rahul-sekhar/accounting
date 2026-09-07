import type { Mapping, ParsedTransaction } from './banking';

export const IMPORT_REPORT_VERSION = 1;
export const IMPORT_OUTCOMES = [
  'added',
  'duplicate_skipped',
  'duplicate_enriched',
] as const;
export type ImportOutcome = (typeof IMPORT_OUTCOMES)[number];

export function normalizeMapping(mapping: Mapping): Mapping {
  return {
    date: mapping.date,
    description: mapping.description,
    subDescription: mapping.subDescription || '',
    amount: mapping.amount || '',
    debit: mapping.debit || '',
    credit: mapping.credit || '',
    mode: mapping.mode,
    sign: mapping.sign,
    dateFormat: mapping.dateFormat,
  };
}

export function validOperationId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function sha256(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function transactionFingerprint(transaction: Pick<ParsedTransaction, 'date' | 'description' | 'amount' | 'occurrence'>) {
  return sha256(JSON.stringify([
    transaction.date,
    transaction.description.toLowerCase().replace(/\s+/g, ' '),
    transaction.amount,
    transaction.occurrence,
  ]));
}

export function importRequestKey(input: {
  csv: string;
  filename: string;
  mapping: Mapping;
  accountId?: string | null;
  account?: { bank: string; name: string; type: string; currency: string };
}) {
  return JSON.stringify({
    csv: input.csv,
    filename: input.filename,
    mapping: normalizeMapping(input.mapping),
    accountId: input.accountId || null,
    account: input.accountId ? null : input.account,
  });
}

export function parseImportListCursor(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(parsed[0]) || !parsed[1]) return undefined;
    return { createdAt: parsed[0], id: parsed[1] };
  } catch {
    return undefined;
  }
}

export function importListCursor(createdAt: string, id: string) {
  return JSON.stringify([createdAt, id]);
}

export function pageLimit(value: string | null) {
  if (!value) return 50;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= 100 ? parsed : null;
}
