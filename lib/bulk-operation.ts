export type BulkOperationKind = 'delete' | 'categorize';
export type BulkOperationStatus =
  | 'running'
  | 'unresolved'
  | 'stopped'
  | 'failed'
  | 'completed';

export type BulkOutcome = {
  resolvedIds: string[];
  deletedIds?: string[];
  categorizedIds?: string[];
  protectedIds?: string[];
  unavailableIds?: string[];
  deleted?: number;
  categorized?: number;
  protected?: number;
  unavailable: number;
};

export type BulkBatch = {
  ids: string[];
  operationId: string;
  status: 'unsent' | 'sending' | 'unresolved' | 'failed' | 'committed';
  outcome?: BulkOutcome;
};

export type BulkOperation = {
  kind: BulkOperationKind;
  status: BulkOperationStatus;
  total: number;
  processed: number;
  deleted: number;
  categorized: number;
  protected: number;
  unavailable: number;
  remaining: string[];
  batches: BulkBatch[];
  error?: string;
  refreshError?: string;
  retryable?: boolean;
  staleRetry?: boolean;
};

export type BulkRequestError = Error & {
  status?: number;
  code?: string;
  certainty?: 'unresolved' | 'precommit';
};

type Handlers = {
  request: (
    kind: BulkOperationKind,
    payload: { operationId: string; ids: string[] },
  ) => Promise<unknown>;
  normalize: (
    kind: BulkOperationKind,
    ids: readonly string[],
    result: unknown,
  ) => BulkOutcome;
  refresh: () => Promise<unknown>;
  committed: (
    kind: BulkOperationKind,
    ids: readonly string[],
    outcome: BulkOutcome,
  ) => void;
  changed: (operation: BulkOperation | null) => void;
  uuid: () => string;
};

function remaining(operation: BulkOperation) {
  return operation.batches
    .filter((batch) => batch.status !== 'committed')
    .flatMap((batch) => batch.ids);
}

export function classifyBulkRequestError(error: BulkRequestError) {
  if (error.certainty === 'unresolved')
    return { status: 'unresolved' as const, retryable: true };
  if (error.code === 'stale_context')
    return { status: 'failed' as const, retryable: true, staleRetry: true };
  if (error.code === 'operation_conflict')
    return { status: 'failed' as const, retryable: false };
  if (error.certainty === 'precommit')
    return {
      status: 'failed' as const,
      retryable: !error.status || error.status >= 500,
    };
  if (error.status && error.status >= 400 && error.status < 500)
    return { status: 'failed' as const, retryable: error.status === 409 };
  return { status: 'unresolved' as const, retryable: true };
}

export class BulkOperationController {
  private handlers: Handlers;
  private operation: BulkOperation | null = null;
  private stopRequested = false;
  private executing = false;
  private recovering = false;

  constructor(handlers: Handlers) {
    this.handlers = handlers;
  }

  setHandlers(handlers: Handlers) {
    this.handlers = handlers;
  }

  get current() {
    return this.operation;
  }

  get locked() {
    return (
      this.executing ||
      this.operation?.status === 'running' ||
      this.operation?.status === 'unresolved'
    );
  }

  start(kind: BulkOperationKind, ids: readonly string[]) {
    if (this.locked || !ids.length) return false;
    if (
      this.operation &&
      this.operation.status !== 'completed' &&
      this.operation.remaining.length
    )
      return false;
    const size = kind === 'delete' ? 50 : 60;
    const batches: BulkBatch[] = [];
    for (let offset = 0; offset < ids.length; offset += size)
      batches.push({
        ids: ids.slice(offset, offset + size),
        operationId: this.handlers.uuid(),
        status: 'unsent',
      });
    this.operation = {
      kind,
      status: 'running',
      total: ids.length,
      processed: 0,
      deleted: 0,
      categorized: 0,
      protected: 0,
      unavailable: 0,
      remaining: [...ids],
      batches,
    };
    this.stopRequested = false;
    this.publish();
    void this.run();
    return true;
  }

  stop() {
    if (this.operation?.status === 'running') this.stopRequested = true;
  }

  async resume() {
    if (!this.operation || this.locked) return false;
    if (
      !['failed', 'stopped'].includes(this.operation.status) ||
      !this.operation.remaining.length ||
      this.operation.retryable === false
    )
      return false;
    if (this.operation.staleRetry) {
      await this.refreshOnly();
      if (this.operation.refreshError) return false;
      const failed = this.operation.batches.find(
        (batch) => batch.status === 'failed',
      );
      if (failed) failed.operationId = this.handlers.uuid();
    }
    for (const batch of this.operation.batches)
      if (batch.status === 'failed') batch.status = 'unsent';
    this.operation.status = 'running';
    this.operation.error = undefined;
    this.recovering = false;
    this.operation.retryable = undefined;
    this.operation.staleRetry = undefined;
    this.stopRequested = false;
    this.publish();
    void this.run();
    return true;
  }

  recover() {
    if (
      !this.operation ||
      this.operation.status !== 'unresolved' ||
      this.executing
    )
      return false;
    this.operation.status = 'running';
    this.operation.error = undefined;
    this.recovering = true;
    this.publish();
    void this.run();
    return true;
  }

  retryRefresh() {
    if (!this.operation?.refreshError) return false;
    void this.refreshOnly();
    return true;
  }

  abandon() {
    if (this.locked) return false;
    this.operation = null;
    this.stopRequested = false;
    this.publish();
    return true;
  }

  private publish() {
    if (this.operation) this.operation.remaining = remaining(this.operation);
    this.handlers.changed(
      this.operation
        ? {
            ...this.operation,
            remaining: [...this.operation.remaining],
            batches: this.operation.batches.map((batch) => ({
              ...batch,
              ids: [...batch.ids],
            })),
          }
        : null,
    );
  }

  private async refreshOnly() {
    if (!this.operation) return;
    try {
      await this.handlers.refresh();
      this.operation.refreshError = undefined;
    } catch (error) {
      this.operation.refreshError = (error as Error).message;
    }
    this.publish();
  }

  private async run() {
    if (!this.operation || this.executing) return;
    this.executing = true;
    try {
      while (this.operation) {
        if (this.stopRequested && !this.recovering) {
          this.operation.status = 'stopped';
          this.publish();
          return;
        }
        const batch = this.operation.batches.find(
          (candidate) => candidate.status !== 'committed',
        );
        if (!batch) {
          this.operation.status = 'completed';
          this.publish();
          return;
        }
        // An unresolved batch is always replayed verbatim before unsent work.
        batch.status = 'sending';
        this.operation.status = 'running';
        this.publish();
        try {
          const raw = await this.handlers.request(this.operation.kind, {
            operationId: batch.operationId,
            ids: [...batch.ids],
          });
          const outcome = this.handlers.normalize(
            this.operation.kind,
            batch.ids,
            raw,
          );
          batch.status = 'committed';
          this.recovering = false;
          batch.outcome = outcome;
          this.operation.processed += batch.ids.length;
          this.operation.deleted += outcome.deleted || 0;
          this.operation.categorized += outcome.categorized || 0;
          this.operation.protected += outcome.protected || 0;
          this.operation.unavailable += outcome.unavailable;
          this.handlers.committed(this.operation.kind, batch.ids, outcome);
          this.publish();
          await this.refreshOnly();
        } catch (caught) {
          const error = caught as BulkRequestError;
          const policy = classifyBulkRequestError(error);
          this.recovering = false;
          batch.status =
            policy.status === 'unresolved' ? 'unresolved' : 'failed';
          this.operation.status = policy.status;
          this.operation.error = error.message;
          this.operation.retryable = policy.retryable;
          this.operation.staleRetry = policy.staleRetry;
          this.publish();
          return;
        }
      }
    } finally {
      this.executing = false;
    }
  }
}
