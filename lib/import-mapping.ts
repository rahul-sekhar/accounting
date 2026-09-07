import { parseMoney, type CsvData, type Mapping } from './banking.ts';

/** Keeps delayed suggestions from replacing a newer file, account, or manual edit. */
export class MappingSuggestionGate {
  private version = 0;

  begin() {
    return ++this.version;
  }

  invalidate() {
    this.version++;
  }

  accepts(version: number) {
    return version === this.version;
  }
}

const MONEY_HEADER =
  /amount|debit|credit|withdrawal|deposit|money[ _-]?(?:in|out)/i;
const BALANCE_HEADER = /balance|available|limit|account|quantity|unit price/i;
const DEBIT_HEADER = /debit|withdrawal|money[ _-]?out/i;
const CREDIT_HEADER = /credit|deposit|money[ _-]?in/i;
const DIRECTION_WORD =
  /\b(?:refund|reversal|purchase|withdrawal|deposit|payroll|salary|payment received|cash advance)\b/i;

function rowFeatures(headers: string[], row: string[]) {
  const features = new Set<string>();
  const moneyIndexes = headers
    .map((header, index) =>
      MONEY_HEADER.test(header) && !BALANCE_HEADER.test(header) ? index : -1,
    )
    .filter((index) => index >= 0);
  for (const index of moneyIndexes) {
    const raw = row[index]?.trim() || '';
    const amount = parseMoney(raw);
    if (!raw) features.add(`blank:${index}`);
    else if (amount === 0) features.add(`zero:${index}`);
    else if (amount !== null)
      features.add(`${amount < 0 ? 'negative' : 'positive'}:${index}`);
  }

  const debit = headers.findIndex((header) => DEBIT_HEADER.test(header));
  const credit = headers.findIndex((header) => CREDIT_HEADER.test(header));
  if (debit >= 0 && credit >= 0) {
    const hasDebit = !!row[debit]?.trim();
    const hasCredit = !!row[credit]?.trim();
    features.add(
      hasDebit && hasCredit
        ? 'split:both'
        : hasDebit
          ? 'split:debit'
          : hasCredit
            ? 'split:credit'
            : 'split:blank',
    );
  }
  if (
    row.some(
      (cell, index) =>
        !moneyIndexes.includes(index) && DIRECTION_WORD.test(cell),
    )
  )
    features.add('explicit-direction');
  return features;
}

/**
 * Selects a small deterministic sample that covers sign and split-column
 * variation without sending the complete CSV to the mapping provider.
 */
export function selectRepresentativeRows(csv: CsvData, limit = 5) {
  const count = Math.max(0, Math.min(5, Math.floor(limit)));
  if (!count || !csv.rows.length) return [];
  const selected = [0];
  const covered = rowFeatures(csv.headers, csv.rows[0]);
  const features = csv.rows.map((row) => rowFeatures(csv.headers, row));

  while (selected.length < count) {
    let best = -1;
    let bestGain = 0;
    for (let index = 1; index < csv.rows.length; index++) {
      if (selected.includes(index)) continue;
      const gain = [...features[index]].filter(
        (item) => !covered.has(item),
      ).length;
      if (gain > bestGain) {
        best = index;
        bestGain = gain;
      }
    }
    if (best < 0) break;
    selected.push(best);
    for (const feature of features[best]) covered.add(feature);
  }

  // Fill unused slots across the file so homogeneous exports still include
  // early, middle, and late records.
  for (let step = 1; selected.length < count && step <= count; step++) {
    const index = Math.round((step * (csv.rows.length - 1)) / count);
    if (!selected.includes(index)) selected.push(index);
  }
  for (
    let index = 0;
    selected.length < count && index < csv.rows.length;
    index++
  )
    if (!selected.includes(index)) selected.push(index);

  return selected
    .slice(0, count)
    .sort((a, b) => a - b)
    .map((index) => csv.rows[index]);
}

export function assessDirectionEvidence(csv: CsvData, mapping: Mapping) {
  if (mapping.mode === 'split') return { uncertain: false, note: '' };
  const amountIndex = csv.headers.indexOf(mapping.amount);
  if (amountIndex < 0)
    return {
      uncertain: true,
      note: 'Amount direction could not be verified.',
    };
  const amounts = csv.rows
    .map((row) => parseMoney(row[amountIndex] || ''))
    .filter((amount): amount is number => amount !== null);
  const hasExplicitDirection = csv.rows.some((row) =>
    row.some(
      (cell, index) => index !== amountIndex && DIRECTION_WORD.test(cell),
    ),
  );
  const nonZeroSigns = new Set(
    amounts.filter(Boolean).map((amount) => Math.sign(amount)),
  );
  if (!amounts.length || !nonZeroSigns.size)
    return {
      uncertain: true,
      note: 'The sample has no non-zero amounts, so amount direction is uncertain.',
    };
  if (nonZeroSigns.size === 1 && !hasExplicitDirection)
    return {
      uncertain: true,
      note: 'The sampled amounts all use one sign and have no explicit transaction-direction labels, so confirm whether money out should be negative.',
    };
  return { uncertain: false, note: '' };
}
