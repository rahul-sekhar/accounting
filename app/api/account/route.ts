import { getDb } from '@/db';
import { AccountInputError, parseAccountInput } from '@/lib/accounts';
import {
  AccountStoreError,
  createAccount,
  deleteAccount,
  setAccountArchived,
  updateAccount,
} from '@/lib/accounts-server';
import {
  identity,
  json,
  failure,
  body,
  AppError,
  textValue,
} from '@/lib/server';

function accountInput(value: unknown) {
  try {
    return parseAccountInput(value);
  } catch (error) {
    if (error instanceof AccountInputError) throw new AppError(error.message);
    throw error;
  }
}

function rejectLegacyBalanceFields(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const candidate = value as Record<string, unknown>;
  if (
    'balance' in candidate ||
    'balanceDate' in candidate ||
    'balance_date' in candidate
  )
    throw new AppError('Account balances are no longer stored.');
}

function accountFailure(error: unknown) {
  return failure(
    error instanceof AccountStoreError
      ? new AppError(error.message, error.status)
      : error,
  );
}

export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const value = await body(request);
    rejectLegacyBalanceFields(value);
    const input = accountInput(value);
    const account = await createAccount(getDb(), user.userId, input);
    return json({ account });
  } catch (error) {
    return accountFailure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await identity(request);
    const value = await body(request);
    rejectLegacyBalanceFields(value);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new AppError('Invalid request body.');
    const candidate = value as Record<string, unknown>;
    const id = textValue(candidate.id);
    const action = candidate.action;
    if (action === 'archive' || action === 'restore') {
      const account = await setAccountArchived(
        getDb(),
        user.userId,
        id,
        action === 'archive',
      );
      return json({ account });
    }
    if (action !== 'update')
      throw new AppError('Choose a valid account action.');
    const input = accountInput(candidate);
    const account = await updateAccount(getDb(), user.userId, id, input);
    return json({ account });
  } catch (error) {
    return accountFailure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await identity(request);
    const value = await body(request);
    rejectLegacyBalanceFields(value);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new AppError('Invalid request body.');
    const id = textValue((value as Record<string, unknown>).id);
    await deleteAccount(getDb(), user.userId, id);
    return json({ deleted: true });
  } catch (error) {
    return accountFailure(error);
  }
}
