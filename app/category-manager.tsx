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
import type { MemoryCluster, ReviewMemoryRow } from '@/lib/review-memory';
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
    [error, setError] = useState(''),
    [view, setView] = useState<'categories' | 'memory'>('categories'),
    [memory, setMemory] = useState<{ clusters: MemoryCluster[]; reviews: ReviewMemoryRow[] } | null>(null);
  async function loadMemory() {
    const response = await fetch('/api/review-memory');
    const result = (await response.json()) as {
      clusters?: MemoryCluster[];
      reviews?: ReviewMemoryRow[];
      error?: string;
    };
    if (!response.ok) throw new Error(result.error || 'Could not load categorization memory.');
    setMemory({ clusters: result.clusters || [], reviews: result.reviews || [] });
  }
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
          if (!v) setView('categories');
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
          <div className="manager-tabs" role="tablist" aria-label="Category settings">
            <button className={view === 'categories' ? 'active' : ''} onClick={() => setView('categories')}>
              Categories
            </button>
            <button
              className={view === 'memory' ? 'active' : ''}
              onClick={() => {
                setView('memory');
                void loadMemory().catch((e) => setError(e.message));
              }}
            >
              Categorization memory
            </button>
          </div>
          {view === 'categories' ? (
          <>
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
          </>
          ) : (
            <div className="memory-view">
              <p className="import-note">
                These are your latest explicit reviews. The AI may use them as context; this is reference-based personalization, not training or a guaranteed rule.
              </p>
              {!memory ? (
                <p className="subtle">Loading categorization memory…</p>
              ) : !memory.reviews.length ? (
                <p className="small-empty">No reviewed transactions yet.</p>
              ) : (
                <>
                  <div className="memory-summary">
                    <strong>{memory.clusters.length} active patterns</strong>
                    <span>{memory.reviews.length} reviewed transactions</span>
                  </div>
                  {memory.clusters.map((cluster) => (
                    <details className="memory-cluster" key={cluster.clusterId}>
                      <summary>
                        <span>{cluster.representativeDescription}{cluster.representativeSubDescription ? ` · ${cluster.representativeSubDescription}` : ''}</span>
                        <span>{cluster.conflicting ? 'Conflicting alternatives' : cluster.alternatives[0]?.categoryName}</span>
                      </summary>
                      <p className="subtle">{cluster.accountType} · {cluster.currency} · {cluster.direction}</p>
                      {cluster.alternatives.map((alternative) => (
                        <div className="memory-alternative" key={alternative.memoryId}>
                          <strong>{alternative.categoryName}</strong>
                          <span>{alternative.reviewedTransactionCount} distinct {alternative.reviewedTransactionCount === 1 ? 'review' : 'reviews'}</span>
                        </div>
                      ))}
                    </details>
                  ))}
                  <h3>Contributing transactions</h3>
                  <div className="memory-transactions">
                    {memory.reviews.map((review) => (
                      <div key={review.transactionId} className="memory-transaction">
                        <span>
                          <strong>{review.description}</strong>
                          <small>
                            {review.subDescription ? `${review.subDescription} · ` : ''}
                            {categories.find((category) => category.id === review.categoryId)?.name || review.categoryId}
                            {review.origin === 'legacy_backfill' ? ' · migrated prior decision' : ''}
                          </small>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
