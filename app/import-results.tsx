'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, FileSpreadsheet, LoaderCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { money } from '@/lib/banking';

type Report = {
  id: string;
  account_id: string;
  filename: string;
  added: number;
  skipped: number;
  enriched: number;
  created_at: string;
  account_name: string;
  institution: string;
  currency: string;
};
type Outcome = {
  row_ordinal: number;
  occurrence: number;
  date: string;
  description: string;
  sub_description: string;
  amount: number;
  outcome: 'duplicate_skipped' | 'duplicate_enriched';
  action_detail: string;
  current_transaction_id: string | null;
};

async function readPage(importId: string, cursor?: string) {
  const params = new URLSearchParams({ outcome: 'duplicate', limit: '50' });
  if (cursor) params.set('cursor', cursor);
  const response = await fetch(`/api/imports/${encodeURIComponent(importId)}?${params}`);
  const result = (await response.json()) as {
    error?: string;
    import: Report;
    outcomes: Outcome[];
    nextCursor: string | null;
    detailsAvailable: boolean;
  };
  if (!response.ok) throw new Error(result.error || 'Could not load this import.');
  return result;
}

export default function ImportResults({ importId }: { importId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [detailsAvailable, setDetailsAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await readPage(importId, cursor);
      setReport(result.import);
      setDetailsAvailable(result.detailsAvailable);
      setOutcomes((current) => (cursor ? [...current, ...result.outcomes] : result.outcomes));
      setNextCursor(result.nextCursor);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [importId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <main className="import-results-page">
      <Link className="back-link" href="/?view=transactions">
        <ArrowLeft size={16} /> Back to transactions
      </Link>
      {error && (
        <div className="message error" role="alert">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </div>
      )}
      {!report && loading ? (
        <div className="results-loading"><LoaderCircle className="spin" size={22} /> Loading import results…</div>
      ) : report ? (
        <>
          <div className="results-heading">
            <div className="results-icon"><FileSpreadsheet size={25} /></div>
            <div>
              <p className="eyebrow">IMPORT RESULTS</p>
              <h1>{report.filename}</h1>
              <p className="subtle">
                {report.account_name} · {report.institution} · {new Date(report.created_at).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="results-summary" aria-label="Import summary">
            <div><span>Total rows</span><strong>{report.added + report.skipped}</strong></div>
            <div><span>Added</span><strong>{report.added}</strong></div>
            <div><span>Matched</span><strong>{report.skipped}</strong></div>
            <div><span>Enriched</span><strong>{report.enriched}</strong></div>
          </div>
          <section className="section results-panel">
            <div className="section-heading">
              <div>
                <h2>Matching rows and actions</h2>
                <p className="subtle">Matched includes rows enriched with a missing sub-description.</p>
              </div>
              <Link className="secondary-link" href={`/?view=transactions&importId=${encodeURIComponent(report.id)}`}>
                View imported transactions
              </Link>
            </div>
            {!detailsAvailable ? (
              <div className="small-empty">Row-level details are unavailable for this older import. Its original totals are preserved.</div>
            ) : report.skipped === 0 ? (
              <div className="results-empty">
                <CheckCircle2 size={24} />
                <div><strong>No duplicates found</strong><p className="subtle">Every row in this file was added as a new transaction.</p></div>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Row</TableHead><TableHead>Date</TableHead><TableHead>Description</TableHead>
                    <TableHead>Incoming detail</TableHead><TableHead>Action</TableHead><TableHead className="right">Amount</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {outcomes.map((item) => (
                      <TableRow key={item.row_ordinal}>
                        <TableCell>{item.row_ordinal}</TableCell>
                        <TableCell>{item.date}</TableCell>
                        <TableCell>{item.description}{item.occurrence > 1 && <span className="occurrence">Occurrence {item.occurrence}</span>}</TableCell>
                        <TableCell>{item.sub_description || <span className="subtle">None</span>}</TableCell>
                        <TableCell><span className={`outcome-badge ${item.outcome === 'duplicate_enriched' ? 'enriched' : ''}`}>{item.action_detail}</span>{!item.current_transaction_id && <span className="unavailable-note">Transaction no longer available</span>}</TableCell>
                        <TableCell className="right">{money(item.amount, report.currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {nextCursor && <button className="secondary results-more" disabled={loading} onClick={() => void load(nextCursor)}>{loading ? 'Loading…' : 'Load more matches'}</button>}
              </>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
