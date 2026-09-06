export const CATEGORIES = [
  'Uncategorized',
  'Groceries',
  'Dining',
  'Shopping',
  'Housing',
  'Utilities',
  'Transportation',
  'Health',
  'Entertainment',
  'Travel',
  'Education',
  'Fees & interest',
  'Income',
  'Investment income',
  'Transfers',
  'Investments',
  'Other',
] as const;
export type Category = (typeof CATEGORIES)[number];
export type Account = {
  id: string;
  bank: string;
  name: string;
  type: string;
  currency: string;
  balance: number | null;
  balance_date: string | null;
};
export type Transaction = {
  id: string;
  account_id: string;
  date: string;
  description: string;
  amount: number;
  category: Category;
  source: string;
  confidence: string | null;
};
export type ImportRecord = {
  id: string;
  account_id: string;
  filename: string;
  added: number;
  skipped: number;
  created_at: string;
};
export type AppData = {
  accounts: Account[];
  transactions: Transaction[];
  imports: ImportRecord[];
  aiReady: boolean;
  user: string;
};
export type CsvData = { headers: string[]; rows: string[][] };
export type Mapping = {
  date: string;
  description: string;
  amount: string;
  debit: string;
  credit: string;
  mode: 'signed' | 'split';
  sign: 'normal' | 'reverse';
  dateFormat: 'YMD' | 'MDY' | 'DMY';
};
export type ParsedTransaction = {
  date: string;
  description: string;
  amount: number;
  occurrence: number;
};
export function parseCsv(text: string): CsvData {
  if (text.length > 5_000_000)
    throw new Error('Choose a CSV smaller than 5 MB.');
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/)[0];
  const delimiter =
    first.split('\t').length > first.split(',').length
      ? '\t'
      : first.split(';').length > first.split(',').length
        ? ';'
        : ',';
  const all: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || field === '') quoted = !quoted;
      else field += c;
    } else if (c === delimiter && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some(Boolean)) all.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted)
    throw new Error('The CSV has an unclosed quoted field. Export it again.');
  row.push(field.trim());
  if (row.some(Boolean)) all.push(row);
  if (all.length < 2) throw new Error('No transaction rows found in this CSV.');
  // Some bank exports include account information above their header row.
  const headerIndex = all.findIndex(
    (r) =>
      r.some((c) =>
        /^(transaction |posted |posting |trade |settlement )?date$/i.test(c),
      ) && r.some((c) => /description|details|amount|debit|credit/i.test(c)),
  );
  const headerless =
    headerIndex < 0 &&
    all[0].some((v) =>
      /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$|^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(v),
    );
  const idx = headerIndex < 0 ? 0 : headerIndex;
  const headers = headerless
    ? all[0].map((_, i) => `Column ${i + 1}`)
    : all[idx].map((h, i) => h || `Column ${i + 1}`);
  if (new Set(headers).size !== headers.length)
    throw new Error(
      'The CSV has duplicate column names. Give each column a unique header.',
    );
  const rows = headerless ? all : all.slice(idx + 1);
  if (rows.length > 2000)
    throw new Error(
      'Import up to 2,000 rows at a time. Export a shorter date range.',
    );
  return { headers, rows };
}
export function suggestMapping(headers: string[]): Mapping {
  const pick = (patterns: RegExp[]) =>
    patterns.map((p) => headers.find((h) => p.test(h))).find(Boolean) || '';
  const debit = pick([/^debit(?:s| amount)?$/i, /withdrawal|money out/i]);
  const credit = pick([/^credit(?:s| amount)?$/i, /deposit|money in/i]);
  return {
    date: pick([
      /^date$/i,
      /transaction date|posted date|posting date|trade date/i,
    ]),
    description: pick([
      /^description$/i,
      /transaction description|details|payee|activity/i,
    ]),
    amount: pick([/^amount$/i, /net amount|transaction amount|total amount/i]),
    debit,
    credit,
    mode: debit && credit ? 'split' : 'signed',
    sign: 'normal',
    dateFormat: 'YMD',
  };
}
export function parseMoney(value: string): number | null {
  let v = value.trim();
  if (!v) return null;
  const parentheses = /^\(.*\)$/.test(v);
  v = v
    .replace(/[,$£€\s]/g, '')
    .replace(/^(CAD|USD)/i, '')
    .replace(/[()]/g, '');
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(v)) return null;
  const n = Math.round(Number(v) * 100) * (parentheses ? -1 : 1);
  return Number.isSafeInteger(n) && Math.abs(n) <= 100_000_000_000 ? n : null;
}
export function parseDate(
  value: string,
  format: Mapping['dateFormat'],
): string | null {
  const v = value.trim();
  let year: number, month: number, day: number;
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$/.exec(v);
  const numeric = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(v);
  if (iso) {
    year = +iso[1];
    month = +iso[2];
    day = +iso[3];
  } else if (numeric && format !== 'YMD') {
    year = +numeric[3];
    month = +numeric[format === 'MDY' ? 1 : 2];
    day = +numeric[format === 'MDY' ? 2 : 1];
  } else {
    const named =
      /^(\d{1,2})[- ]([A-Za-z]{3})[- ,]+(\d{4})$/.exec(v) ||
      /^([A-Za-z]{3}) +(\d{1,2}),? +(\d{4})$/.exec(v);
    if (!named) return null;
    const a = /^\d/.test(named[1]);
    day = +(a ? named[1] : named[2]);
    month =
      [
        'jan',
        'feb',
        'mar',
        'apr',
        'may',
        'jun',
        'jul',
        'aug',
        'sep',
        'oct',
        'nov',
        'dec',
      ].indexOf((a ? named[2] : named[1]).toLowerCase()) + 1;
    year = +named[3];
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    year > 2200 ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  )
    return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export function mapTransactions(
  csv: CsvData,
  m: Mapping,
): { transactions: ParsedTransaction[]; errors: string[] } {
  const errors: string[] = [];
  const transactions: ParsedTransaction[] = [];
  const seen = new Map<string, number>();
  const cell = (r: string[], h: string) => r[csv.headers.indexOf(h)] || '';
  if (
    !m.date ||
    !m.description ||
    (m.mode === 'signed' ? !m.amount : !m.debit || !m.credit)
  )
    return {
      transactions,
      errors: ['Choose the date, description, and amount columns.'],
    };
  csv.rows.forEach((r, index) => {
    if (r.length !== csv.headers.length) {
      errors.push(
        `Row ${index + 2}: ${r.length} fields; expected ${csv.headers.length}.`,
      );
      return;
    }
    const date = parseDate(cell(r, m.date), m.dateFormat);
    const description = cell(r, m.description).trim();
    let amount: number | null;
    if (m.mode === 'split') {
      const dv = cell(r, m.debit),
        cv = cell(r, m.credit),
        d = parseMoney(dv),
        c = parseMoney(cv);
      amount =
        (dv && d === null) || (cv && c === null) || (!dv && !cv)
          ? null
          : Math.abs(c || 0) - Math.abs(d || 0);
    } else amount = parseMoney(cell(r, m.amount));
    if (!date || !description || description.length > 500 || amount === null) {
      errors.push(
        `Row ${index + 2}: check ${!date ? 'date' : !description || description.length > 500 ? 'description' : 'amount'}.`,
      );
      return;
    }
    amount *= m.sign === 'reverse' ? -1 : 1;
    const key = JSON.stringify([
      date,
      description.toLowerCase().replace(/\s+/g, ' '),
      amount,
    ]);
    const occurrence = (seen.get(key) || 0) + 1;
    seen.set(key, occurrence);
    transactions.push({ date, description, amount, occurrence });
  });
  return { transactions, errors };
}
export function summary(transactions: Transaction[]) {
  let income = 0,
    spending = 0;
  for (const t of transactions) {
    if (['Transfers', 'Investments'].includes(t.category)) continue;
    if (
      ['Income', 'Investment income'].includes(t.category) ||
      (t.category === 'Uncategorized' && t.amount > 0)
    )
      income += t.amount;
    else spending -= t.amount;
  }
  return { income, spending };
}
export const money = (cents: number, currency = 'CAD') =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(
    cents / 100,
  );
