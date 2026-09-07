export const ACCOUNT_TYPES = [
  'Chequing',
  'Savings',
  'Credit card',
  'Investment',
] as const;

export const ACCOUNT_CURRENCIES = ['CAD', 'USD'] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type AccountCurrency = (typeof ACCOUNT_CURRENCIES)[number];

export type AccountInput = {
  bank: string;
  name: string;
  type: AccountType;
  currency: AccountCurrency;
};

export class AccountInputError extends Error {}

function requiredText(value: unknown, label: string) {
  if (typeof value !== 'string')
    throw new AccountInputError(`${label} is required.`);
  const normalized = value.trim();
  if (!normalized) throw new AccountInputError(`${label} is required.`);
  if (normalized.length > 80)
    throw new AccountInputError(`${label} must be 80 characters or fewer.`);
  return normalized;
}

export function parseAccountInput(value: unknown): AccountInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AccountInputError('Check the account details.');
  const candidate = value as Record<string, unknown>;
  const bank = requiredText(candidate.bank, 'Institution');
  const name = requiredText(candidate.name, 'Account nickname');
  if (
    typeof candidate.type !== 'string' ||
    !ACCOUNT_TYPES.includes(candidate.type as AccountType)
  )
    throw new AccountInputError('Choose a supported account type.');
  if (
    typeof candidate.currency !== 'string' ||
    !ACCOUNT_CURRENCIES.includes(candidate.currency as AccountCurrency)
  )
    throw new AccountInputError('Choose CAD or USD.');
  return {
    bank,
    name,
    type: candidate.type as AccountType,
    currency: candidate.currency as AccountCurrency,
  };
}
