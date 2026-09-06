'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import type { CategoryDefinition, CategoryKind } from '@/lib/banking';
const kinds = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'investment', label: 'Investment' },
];
export default function CategoryManager({
  open,
  onOpenChange,
  categories,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: CategoryDefinition[];
  onSaved: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<string | null>(null),
    [name, setName] = useState(''),
    [kind, setKind] = useState<CategoryKind>('expense'),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  async function save(item: CategoryDefinition | undefined, archive?: boolean) {
    setSaving(true);
    setError('');
    try {
      const r = await fetch('/api/categories', {
        method: item ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item?.id,
          name: archive === undefined ? name : item?.name,
          kind: archive === undefined ? kind : item?.kind,
          archived: archive ?? item?.archived ?? false,
        }),
      });
      const result = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(result.error || 'Could not save category.');
      await onSaved();
      setEditing(null);
      setName('');
      setKind('expense');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!saving) {
          onOpenChange(v);
          setError('');
          setEditing(null);
        }
      }}
    >
      <DialogContent className="category-dialog">
        <DialogHeader>
          <DialogTitle className="dialog-title">Manage categories</DialogTitle>
          <DialogDescription>
            Create and rename categories, or archive ones you no longer use.
            Archived categories remain on past transactions and can be restored.
          </DialogDescription>
        </DialogHeader>
        <div className="category-scroll">
          <form
            className="category-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save(categories.find((c) => c.id === editing));
            }}
          >
            <label className="field">
              <span>{editing ? 'Rename category' : 'New category'}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                placeholder="e.g. Home maintenance"
                required
                disabled={saving}
              />
            </label>
            <label className="field">
              <span>Type</span>
              <NativeSelect
                value={kind}
                onChange={(e) => setKind(e.target.value as CategoryKind)}
                disabled={saving}
              >
                {kinds.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <button className="primary" disabled={saving || !name.trim()}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add category'}
            </button>
            {editing && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setEditing(null);
                  setName('');
                  setKind('expense');
                }}
              >
                Cancel edit
              </button>
            )}
          </form>
          <p className="import-note">
            Type controls your totals: expenses include refunds; income adds to
            income; transfers and investments are excluded from both. Changing a
            type updates historical totals.
          </p>
          {error && (
            <div className="message error" role="alert">
              {error}
            </div>
          )}
          <div className="category-list">
            {categories.map((c) => (
              <div
                key={c.id}
                className={'managed-category ' + (c.archived ? 'archived' : '')}
              >
                <div>
                  <strong>{c.name}</strong>
                  <span>
                    {c.kind === 'unclassified'
                      ? 'Fallback'
                      : kinds.find((k) => k.value === c.kind)?.label}
                    {c.archived ? ' · Archived' : ''}
                  </span>
                </div>
                {c.id === 'Uncategorized' ? (
                  <span className="subtle">Always available</span>
                ) : (
                  <div className="category-actions">
                    <button
                      className="text-button"
                      disabled={saving}
                      onClick={() => {
                        setEditing(c.id);
                        setName(c.name);
                        setKind(c.kind);
                        setError('');
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="text-button"
                      disabled={saving}
                      onClick={() => save(c, !c.archived)}
                    >
                      {c.archived ? 'Restore' : 'Archive'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
