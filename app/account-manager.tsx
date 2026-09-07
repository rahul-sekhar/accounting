'use client';

import { useState } from 'react';
import {
  Archive,
  ArrowRight,
  Landmark,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import { ACCOUNT_CURRENCIES, ACCOUNT_TYPES } from '@/lib/accounts';
import type { Account } from '@/lib/banking';

export type AccountDraft = {
  bank: string;
  name: string;
  type: string;
  currency: string;
};

export const EMPTY_ACCOUNT: AccountDraft = {
  bank: '',
  name: '',
  type: 'Chequing',
  currency: 'CAD',
};

export function AccountFields({
  value,
  onChange,
  lockClassification = false,
}: {
  value: AccountDraft;
  onChange: (value: AccountDraft) => void;
  lockClassification?: boolean;
}) {
  const change = (key: keyof AccountDraft, next: string) =>
    onChange({ ...value, [key]: next });
  return (
    <div className="form-grid account-fields">
      <label className="field">
        <span>Institution</span>
        <input
          value={value.bank}
          maxLength={80}
          placeholder="e.g. Coast Capital"
          onChange={(event) => change('bank', event.target.value)}
        />
      </label>
      <label className="field">
        <span>Account nickname</span>
        <input
          value={value.name}
          maxLength={80}
          placeholder="e.g. Everyday chequing"
          onChange={(event) => change('name', event.target.value)}
        />
      </label>
      <label className="field">
        <span>Account type</span>
        <NativeSelect
          value={value.type}
          disabled={lockClassification}
          onChange={(event) => change('type', event.target.value)}
        >
          {ACCOUNT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="field">
        <span>Currency</span>
        <NativeSelect
          value={value.currency}
          disabled={lockClassification}
          onChange={(event) => change('currency', event.target.value)}
        >
          {ACCOUNT_CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </NativeSelect>
      </label>
      {lockClassification && (
        <p className="field-note">
          Type and currency are fixed once an account has history.
        </p>
      )}
    </div>
  );
}

export default function AccountManager({
  accounts,
  transactionAccountIds,
  busy,
  request,
  onChanged,
  onImport,
  onNotice,
  onError,
}: {
  accounts: Account[];
  transactionAccountIds: Set<string>;
  busy: boolean;
  request: <T>(method: string, payload: unknown) => Promise<T>;
  onChanged: () => Promise<unknown>;
  onImport: (account: Account) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [draft, setDraft] = useState<AccountDraft>(EMPTY_ACCOUNT);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  function openEditor(account: Account | 'new') {
    setDraft(
      account === 'new'
        ? EMPTY_ACCOUNT
        : {
            bank: account.bank,
            name: account.name,
            type: account.type,
            currency: account.currency,
          },
    );
    setDialogError('');
    setConfirmDelete(false);
    setEditing(account);
  }

  async function mutate(
    method: 'POST' | 'PATCH' | 'DELETE',
    payload: unknown,
    message: string,
  ) {
    setSaving(true);
    setDialogError('');
    onError('');
    try {
      await request(method, payload);
      await onChanged();
      setEditing(null);
      onNotice(message);
    } catch (error) {
      setDialogError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const selected = editing === 'new' ? null : editing;
  const hasTransactions = selected
    ? transactionAccountIds.has(selected.id)
    : false;

  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <h2>
            Your accounts <span className="count">{accounts.length}</span>
          </h2>
          <p className="subtle">Manage every institution in one place.</p>
        </div>
        <button
          className="text-button"
          onClick={() => openEditor('new')}
          disabled={busy || saving}
        >
          <Plus size={16} /> Add account
        </button>
      </div>
      {accounts.length ? (
        <div className="account-grid">
          {accounts.map((account) => (
            <article
              className={`account-card${account.archived ? ' archived' : ''}`}
              key={account.id}
            >
              <div className="account-top">
                <span className="institution-icon" aria-hidden="true">
                  <Landmark size={19} />
                </span>
                <div>
                  <p className="subtle">{account.bank}</p>
                  <h3>{account.name}</h3>
                </div>
                <span className="account-type">
                  {account.type} · {account.currency}
                </span>
              </div>
              <div className="account-status">
                <span
                  className={
                    account.archived ? 'archived-badge' : 'active-badge'
                  }
                >
                  {account.archived ? 'Archived' : 'Active'}
                </span>
                <button
                  className="icon-button"
                  aria-label={`Edit ${account.name}`}
                  onClick={() => openEditor(account)}
                  disabled={busy || saving}
                >
                  <Pencil size={15} />
                </button>
              </div>
              <div className="account-bottom">
                <span>
                  {account.archived
                    ? 'Kept in historical reports'
                    : 'Ready for transaction imports'}
                </span>
                {!account.archived && (
                  <button
                    className="text-button"
                    onClick={() => onImport(account)}
                    disabled={busy || saving}
                  >
                    Import <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="account-empty">
          <Landmark size={24} />
          <div>
            <strong>No accounts yet</strong>
            <p className="subtle">
              Add an account now, or create one during your first CSV import.
            </p>
          </div>
          <button className="secondary" onClick={() => openEditor('new')}>
            Add account
          </button>
        </div>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setEditing(null);
        }}
      >
        <DialogContent className="account-dialog">
          <DialogHeader>
            <DialogTitle>
              {editing === 'new' ? 'Add account' : 'Edit account'}
            </DialogTitle>
            <DialogDescription>
              Use the institution’s name and a nickname you will recognize.
            </DialogDescription>
          </DialogHeader>
          <AccountFields
            value={draft}
            onChange={setDraft}
            lockClassification={hasTransactions}
          />
          {dialogError && (
            <div className="message error" role="alert">
              {dialogError}
            </div>
          )}
          {confirmDelete && selected && (
            <div className="delete-confirm" role="alert">
              <p>
                Delete {selected.name}? This is only allowed when no history
                exists.
              </p>
              <button
                className="danger"
                disabled={saving}
                onClick={() =>
                  void mutate(
                    'DELETE',
                    { id: selected.id },
                    'Unused account deleted.',
                  )
                }
              >
                <Trash2 size={15} /> Delete account
              </button>
            </div>
          )}
          <div className="dialog-actions account-dialog-actions">
            {selected && !confirmDelete && (
              <>
                <button
                  className="secondary"
                  disabled={saving}
                  onClick={() =>
                    void mutate(
                      'PATCH',
                      {
                        id: selected.id,
                        action: selected.archived ? 'restore' : 'archive',
                      },
                      selected.archived
                        ? 'Account restored.'
                        : 'Account archived.',
                    )
                  }
                >
                  {selected.archived ? (
                    <RotateCcw size={15} />
                  ) : (
                    <Archive size={15} />
                  )}
                  {selected.archived ? 'Restore' : 'Archive'}
                </button>
                <button
                  className="danger-ghost"
                  disabled={saving}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={15} /> Delete
                </button>
              </>
            )}
            <span className="dialog-spacer" />
            <button
              className="secondary"
              disabled={saving}
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
            <button
              className="primary"
              disabled={saving || !draft.bank.trim() || !draft.name.trim()}
              onClick={() =>
                void mutate(
                  editing === 'new' ? 'POST' : 'PATCH',
                  editing === 'new'
                    ? draft
                    : { id: selected?.id, action: 'update', ...draft },
                  editing === 'new' ? 'Account added.' : 'Account updated.',
                )
              }
            >
              {saving
                ? 'Saving…'
                : editing === 'new'
                  ? 'Add account'
                  : 'Save changes'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
