'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileSpreadsheet } from 'lucide-react';
import type { ImportRecord } from '@/lib/banking';

type HistoryRecord = ImportRecord & { account_name: string };

export default function ImportHistory({ initial }: { initial: ImportRecord[] }) {
  const [items, setItems] = useState<HistoryRecord[]>(initial as HistoryRecord[]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load(next?: string) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (next) params.set('cursor', next);
      const response = await fetch(`/api/imports?${params}`);
      const result = (await response.json()) as { items: HistoryRecord[]; nextCursor: string | null; error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not load import history.');
      setItems((current) => next ? [...current, ...result.items] : result.items);
      setCursor(result.nextCursor);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!items.length && !loading) return null;
  return (
    <section className="section import-history">
      <h2>Import history</h2>
      {items.map((item) => (
        <div className="history-row" key={item.id}>
          <FileSpreadsheet size={18} />
          <div>
            <Link href={`/?view=import&importId=${encodeURIComponent(item.id)}`}><strong>{item.filename}</strong></Link>
            <p className="subtle">{item.account_name || 'Account'} · {item.created_at.slice(0, 10)}</p>
          </div>
          <span>{item.added} added <span className="subtle">· {item.skipped} matched{item.enriched ? ` · ${item.enriched} enriched` : ''}</span></span>
        </div>
      ))}
      {error && <p className="message error" role="alert">{error}</p>}
      {cursor && <button className="text-button history-more" disabled={loading} onClick={() => void load(cursor)}>{loading ? 'Loading…' : 'Load older imports'}</button>}
    </section>
  );
}
