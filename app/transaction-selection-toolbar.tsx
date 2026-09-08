'use client';
import { LoaderCircle, Sparkles, Trash2, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Progress } from '@/components/ui/progress';
import type { BulkOperation } from '@/lib/bulk-operation';

type Props = {
  selectedCount: number;
  matchingCount: number;
  eligibleCount: number;
  protectedCount: number;
  rerunCount: number;
  aiReady: boolean;
  operation: BulkOperation | null;
  deleteConfirmOpen: boolean;
  categorizeConfirmOpen: boolean;
  onDeleteConfirmOpenChange: (open: boolean) => void;
  onCategorizeConfirmOpenChange: (open: boolean) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onDelete: () => void;
  onCategorize: () => void;
  onStop: () => void;
  onRetry: () => void;
  onRecover: () => void;
  onRetryRefresh: () => void;
  onAbandon: () => void;
};

export default function TransactionSelectionToolbar(props: Props) {
  const {
    selectedCount,
    matchingCount,
    eligibleCount,
    protectedCount,
    rerunCount,
    aiReady,
    operation,
  } = props;
  const running = operation?.status === 'running';
  const locked = running || operation?.status === 'unresolved';
  const unfinished =
    operation &&
    operation.status !== 'completed' &&
    operation.remaining.length > 0;
  if (!selectedCount && !operation) return null;
  const progress = operation
    ? Math.round((operation.processed / operation.total) * 100)
    : 0;
  return (
    <div className="bulk-toolbar" aria-live="polite">
      <div className="bulk-toolbar-main">
        <strong>{selectedCount} selected</strong>
        {!operation && (
          <span className="subtle">
            {eligibleCount} eligible · {protectedCount} protected
            {rerunCount
              ? ` · ${rerunCount} AI suggestions will be replaced`
              : ''}
            {!aiReady
              ? ' · AI connection pending; manual categories remain available'
              : ''}
          </span>
        )}
        {selectedCount > 0 && selectedCount < matchingCount && !locked && (
          <button className="text-button" onClick={props.onSelectAll}>
            Select all {matchingCount} matching transactions
          </button>
        )}
        {selectedCount > 0 && !locked && (
          <button className="text-button" onClick={props.onClear}>
            <X size={15} /> Clear selection
          </button>
        )}
        <span className="bulk-spacer" />
        {selectedCount > 0 && !locked && !unfinished && (
          <>
            <button
              className="secondary"
              disabled={!aiReady || !eligibleCount}
              title={
                !aiReady
                  ? 'AI categorization is not connected. Manual categories remain available.'
                  : !eligibleCount
                    ? 'The selection contains only protected transactions.'
                    : undefined
              }
              onClick={() => props.onCategorizeConfirmOpenChange(true)}
            >
              <Sparkles size={16} /> Categorize selected
            </button>
            <button
              className="danger"
              onClick={() => props.onDeleteConfirmOpenChange(true)}
            >
              <Trash2 size={16} /> Delete selected
            </button>
          </>
        )}
        {operation?.status === 'running' && (
          <button className="secondary" onClick={props.onStop}>
            Stop after this batch
          </button>
        )}
        {operation?.status === 'unresolved' && (
          <button className="secondary" onClick={props.onRecover}>
            Recover sent batch
          </button>
        )}
        {(operation?.status === 'failed' || operation?.status === 'stopped') &&
          operation.remaining.length > 0 &&
          operation.retryable !== false && (
            <button className="secondary" onClick={props.onRetry}>
              {operation.staleRetry ? 'Refresh and retry' : 'Resume'}{' '}
              {operation.remaining.length} remaining
            </button>
          )}
        {operation?.refreshError && (
          <button className="secondary" onClick={props.onRetryRefresh}>
            Retry refresh
          </button>
        )}
        {unfinished && !locked && (
          <button className="text-button" onClick={props.onAbandon}>
            Abandon remaining work
          </button>
        )}
      </div>
      {operation && (
        <div className="bulk-progress">
          <Progress
            value={progress}
            aria-label={`${operation.processed} of ${operation.total} processed`}
          />
          <span>
            {running && <LoaderCircle className="spin" size={15} />}
            {operation.processed} of {operation.total} processed ·{' '}
            {operation.kind === 'delete'
              ? `${operation.deleted} deleted${operation.unavailable ? ` · ${operation.unavailable} unavailable` : ''}`
              : `${operation.categorized} categorized · ${operation.protected} protected${operation.unavailable ? ` · ${operation.unavailable} unavailable` : ''}`}
          </span>
          {operation.error && (
            <span className="bulk-error">{operation.error}</span>
          )}
          {operation.refreshError && (
            <span className="bulk-error">
              Changes were saved, but the table could not refresh:{' '}
              {operation.refreshError}
            </span>
          )}
        </div>
      )}
      <AlertDialog
        open={props.deleteConfirmOpen}
        onOpenChange={props.onDeleteConfirmOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedCount} transactions?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This deletes exactly the selected transactions across all pages.
              Accounts and import history are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="danger" onClick={props.onDelete}>
              Delete {selectedCount}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={props.categorizeConfirmOpen}
        onOpenChange={props.onCategorizeConfirmOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Categorize {eligibleCount} selected transactions?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Descriptions, sub-descriptions, amounts, currency, and account
              type are sent to OpenAI. Owner details, account names, dates, and
              CSV files are excluded. {protectedCount} protected transaction
              {protectedCount === 1 ? '' : 's'} will be skipped.
              {rerunCount
                ? ` ${rerunCount} unreviewed AI suggestion${rerunCount === 1 ? '' : 's'} may be replaced.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={props.onCategorize}>
              <Sparkles size={16} /> Categorize {eligibleCount}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
