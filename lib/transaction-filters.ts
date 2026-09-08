import {
  needsReview,
  type Account,
  type ImportRecord,
  type Transaction,
} from './banking.ts';

export type TransactionDirection = 'all' | 'debit' | 'credit';
export type TransactionFilters = {
  currency: string;
  q: string;
  direction: TransactionDirection;
  minAmount: string;
  maxAmount: string;
  category: string;
  account: string;
  from: string;
  to: string;
  importGroup: string;
};

export type FilterErrors = Partial<
  Record<'minAmount' | 'maxAmount' | 'date', string>
>;

export const DEFAULT_TRANSACTION_FILTERS: TransactionFilters = {
  currency: 'CAD',
  q: '',
  direction: 'all',
  minAmount: '',
  maxAmount: '',
  category: 'all',
  account: 'all',
  from: '',
  to: '',
  importGroup: '',
};

export function parseAmountBound(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return undefined;
  const [whole, fraction = ''] = trimmed.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined;
}

export function isIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return (
    date.getUTCFullYear() === +match[1] &&
    date.getUTCMonth() === +match[2] - 1 &&
    date.getUTCDate() === +match[3]
  );
}

export function validateTransactionFilters(
  filters: TransactionFilters,
): FilterErrors {
  const errors: FilterErrors = {};
  const min = parseAmountBound(filters.minAmount);
  const max = parseAmountBound(filters.maxAmount);
  if (min === undefined)
    errors.minAmount =
      'Enter a nonnegative amount with up to two decimal places.';
  if (max === undefined)
    errors.maxAmount =
      'Enter a nonnegative amount with up to two decimal places.';
  if (
    min !== null &&
    min !== undefined &&
    max !== null &&
    max !== undefined &&
    min > max
  )
    errors.maxAmount = 'Maximum amount must be at least the minimum.';
  if (
    (filters.from && !isIsoDate(filters.from)) ||
    (filters.to && !isIsoDate(filters.to))
  )
    errors.date = 'Enter real dates in YYYY-MM-DD format.';
  else if (filters.from && filters.to && filters.from > filters.to)
    errors.date = 'End date must be on or after start date.';
  return errors;
}

export function filterTransactions(
  transactions: Transaction[],
  accounts: Account[],
  filters: TransactionFilters,
) {
  const errors = validateTransactionFilters(filters);
  if (Object.keys(errors).length)
    return {
      filteredTransactions: [],
      filteredIds: [],
      filterValid: false,
      errors,
    };
  const accountIds = new Set(
    accounts
      .filter((account) => account.currency === filters.currency)
      .map((account) => account.id),
  );
  const query = filters.q.trim().toLocaleLowerCase();
  const min = parseAmountBound(filters.minAmount);
  const max = parseAmountBound(filters.maxAmount);
  const filteredTransactions = transactions.filter((transaction) => {
    if (!accountIds.has(transaction.account_id)) return false;
    if (filters.account !== 'all' && transaction.account_id !== filters.account)
      return false;
    if (filters.importGroup && transaction.import_id !== filters.importGroup)
      return false;
    if (
      query &&
      !`${transaction.description}\n${transaction.sub_description || ''}`
        .toLocaleLowerCase()
        .includes(query)
    )
      return false;
    if (filters.direction === 'debit' && transaction.amount >= 0) return false;
    if (filters.direction === 'credit' && transaction.amount <= 0) return false;
    const absolute = Math.abs(transaction.amount);
    if (min !== null && min !== undefined && absolute < min) return false;
    if (max !== null && max !== undefined && absolute > max) return false;
    if (
      filters.category === 'review'
        ? !needsReview(transaction)
        : filters.category !== 'all' &&
          transaction.category !== filters.category
    )
      return false;
    if (filters.from && transaction.date < filters.from) return false;
    if (filters.to && transaction.date > filters.to) return false;
    return true;
  });
  return {
    filteredTransactions,
    filteredIds: filteredTransactions.map((transaction) => transaction.id),
    filterValid: true,
    errors,
  };
}

const URL_KEYS: (keyof TransactionFilters)[] = [
  'currency',
  'q',
  'direction',
  'minAmount',
  'maxAmount',
  'category',
  'account',
  'from',
  'to',
  'importGroup',
];
export const TABLE_FILTERS_MARKER = 'tableFilters';

export function filtersToSearchParams(
  filters: TransactionFilters,
  base = new URLSearchParams(),
) {
  for (const key of URL_KEYS) base.delete(key);
  for (const key of URL_KEYS) {
    const value = filters[key];
    const defaultValue = DEFAULT_TRANSACTION_FILTERS[key];
    if (value && value !== defaultValue) base.set(key, value);
  }
  base.set(TABLE_FILTERS_MARKER, 'explicit');
  return base;
}

export function transactionFiltersEqual(
  left: TransactionFilters,
  right: TransactionFilters,
) {
  return URL_KEYS.every((key) => left[key] === right[key]);
}

export function filtersForLocation(
  params: URLSearchParams,
  accounts: Account[],
  imports: ImportRecord[],
  categoryIds: string[],
) {
  const effective = new URLSearchParams(params);
  const suppliedFilters = URL_KEYS.some((key) => effective.has(key));
  if (
    effective.get('view') === 'import' &&
    effective.get('importId') &&
    effective.get(TABLE_FILTERS_MARKER) !== 'explicit' &&
    !suppliedFilters
  )
    effective.set('importGroup', effective.get('importId')!);
  return filtersFromSearchParams(effective, accounts, imports, categoryIds);
}

export function filtersFromSearchParams(
  params: URLSearchParams,
  accounts: Account[],
  imports: ImportRecord[],
  categoryIds: string[],
) {
  const filters = { ...DEFAULT_TRANSACTION_FILTERS };
  const notices: string[] = [];
  const currencies = new Set([
    'CAD',
    'USD',
    ...accounts.map((account) => account.currency),
  ]);
  const currency = params.get('currency');
  if (currency && currencies.has(currency)) filters.currency = currency;
  else if (currency) notices.push('An invalid currency filter was reset.');
  filters.q = params.get('q') || '';
  const direction = params.get('direction');
  if (direction && ['all', 'debit', 'credit'].includes(direction))
    filters.direction = direction as TransactionDirection;
  else if (direction) notices.push('An invalid direction filter was reset.');
  filters.minAmount = params.get('minAmount') || '';
  filters.maxAmount = params.get('maxAmount') || '';
  const category = params.get('category');
  if (
    category &&
    (category === 'all' ||
      category === 'review' ||
      categoryIds.includes(category))
  )
    filters.category = category;
  else if (category) notices.push('An unavailable category filter was reset.');
  const account = params.get('account');
  if (
    account &&
    (account === 'all' || accounts.some((item) => item.id === account))
  )
    filters.account = account;
  else if (account) notices.push('An unavailable account filter was reset.');
  filters.from = params.get('from') || '';
  filters.to = params.get('to') || '';
  const groupId = params.get('importGroup');
  const group = imports.find((item) => item.id === groupId);
  if (group) {
    const groupAccount = accounts.find((item) => item.id === group.account_id);
    filters.importGroup = group.id;
    filters.account = group.account_id;
    if (groupAccount) filters.currency = groupAccount.currency;
  } else if (groupId)
    notices.push('An unavailable import group filter was reset.');
  if (filters.account !== 'all') {
    const selected = accounts.find((item) => item.id === filters.account);
    if (selected && selected.currency !== filters.currency) {
      filters.account = 'all';
      filters.importGroup = '';
      notices.push(
        'An account filter that did not match the selected currency was reset.',
      );
    }
  }
  const urlErrors = validateTransactionFilters(filters);
  if (urlErrors.minAmount) filters.minAmount = '';
  if (urlErrors.maxAmount) filters.maxAmount = '';
  if (urlErrors.date) {
    filters.from = '';
    filters.to = '';
  }
  if (Object.keys(urlErrors).length)
    notices.push('Malformed amount or date filters in the URL were reset.');
  return { filters, notice: notices.join(' ') };
}
