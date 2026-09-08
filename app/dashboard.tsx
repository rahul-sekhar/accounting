'use client';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { isCategorizationEligible } from '@/lib/transaction-categorization';
import {
  BulkOperationController,
  type BulkOperation,
  type BulkOutcome,
} from '@/lib/bulk-operation';
import {
  PanelRightClose,
  PanelRightOpen,
  ChartPie,
  SlidersHorizontal,
  Upload,
  ShieldCheck,
  FileSpreadsheet,
  Sparkles,
  CheckCircle2,
  LoaderCircle,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  LockKeyhole,
  MoreHorizontal,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import CategoryManager from './category-manager';
import AppNavbar from './app-navbar';
import AccountManager, {
  AccountFields,
  EMPTY_ACCOUNT,
  type AccountDraft,
} from './account-manager';
import ImportHistory from './import-history';
import ImportResults from './import-results';
import TransactionSelectionToolbar from './transaction-selection-toolbar';
import MonthlyExpenses from './monthly-expenses';
import ExpenseSpreadDialog from './expense-spread-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import {
  DEFAULT_CATEGORIES,
  parseCsv,
  suggestMapping,
  mapTransactions,
  money,
  type AppData,
  type Account,
  type CsvData,
  type Mapping,
  type Category,
  type Transaction,
  type CategorizationEvidence,
  needsReview,
} from '@/lib/banking';
import {
  MappingSuggestionGate,
  selectRepresentativeRows,
} from '@/lib/import-mapping';
import {
  DEFAULT_TRANSACTION_FILTERS,
  filterTransactions,
  filtersForLocation,
  filtersToSearchParams,
  transactionFiltersEqual,
  type FilterErrors,
  type TransactionFilters,
} from '@/lib/transaction-filters';
import {
  captureMatchingTransactions,
  intersectTransactionSelection,
  pageSelectionState,
  toggleTransaction,
  toggleTransactionPage,
} from '@/lib/transaction-selection';
const initial: AppData = {
  accounts: [],
  transactions: [],
  imports: [],
  categories: DEFAULT_CATEGORIES,
  aiReady: false,
  user: '',
};
async function api<T = Record<string, unknown>>(
  path: string,
  method = 'GET',
  payload?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/${path}`, {
      method,
      headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal,
    });
  } catch (cause) {
    const error = new Error(
      signal?.aborted
        ? 'The request was stopped.'
        : 'The response was lost. Recover the sent batch before continuing.',
      { cause },
    ) as Error & { certainty?: 'unresolved' };
    error.certainty = 'unresolved';
    throw error;
  }
  let result;
  try {
    result = await r.json();
  } catch {
    const error = new Error(
      r.ok
        ? 'The server response was incomplete. Recover the sent batch before continuing.'
        : 'The server response could not be verified. Recover the sent batch before continuing.',
    ) as Error & { status?: number; certainty?: 'unresolved' };
    error.status = r.status;
    error.certainty = 'unresolved';
    throw error;
  }
  if (!r.ok) {
    const error = new Error(
      (result as { error?: string }).error ||
        'Something went wrong. Please try again.',
    ) as Error & {
      status?: number;
      code?: string;
      certainty?: 'unresolved' | 'precommit';
    };
    error.status = r.status;
    error.code = (result as { code?: string }).code;
    const knownPrecommit = new Set([
      'stale_context',
      'operation_conflict',
      'provider_not_configured',
      'provider_transport',
      'provider_rate_limit',
      'provider_auth',
      'provider_unavailable',
      'provider_output',
      'delete_not_committed',
    ]);
    error.certainty =
      knownPrecommit.has(error.code || '') ||
      (r.status >= 400 && r.status < 500)
        ? 'precommit'
        : 'unresolved';
    throw error;
  }
  return result as T;
}
function Picker({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <NativeSelect
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
const opts = (items: string[]) =>
  items.map((value) => ({ value, label: value }));
function TransactionFilterControls({
  filters,
  errors,
  data,
  accounts,
  update,
  disabled = false,
}: {
  filters: TransactionFilters;
  errors: FilterErrors;
  data: AppData;
  accounts: Account[];
  update: (change: Partial<TransactionFilters>, message?: string) => void;
  disabled?: boolean;
}) {
  const currency = filters.currency;
  return (
    <div className="transaction-filters" aria-label="Transaction filters">
      <label className="field filter-search" htmlFor="transaction-search">
        <span>Search</span>
        <input
          disabled={disabled}
          id="transaction-search"
          value={filters.q}
          placeholder="Description or sub-description"
          onChange={(event) => update({ q: event.target.value })}
        />
      </label>
      <Picker
        disabled={disabled}
        label="Currency"
        value={currency}
        onChange={(nextCurrency) =>
          update(
            { currency: nextCurrency },
            filters.importGroup
              ? 'The import group was cleared because the currency changed.'
              : '',
          )
        }
        options={opts(['CAD', 'USD'])}
      />
      <Picker
        disabled={disabled}
        label="Direction"
        value={filters.direction}
        onChange={(direction) =>
          update({ direction: direction as TransactionFilters['direction'] })
        }
        options={[
          { value: 'all', label: 'All directions' },
          { value: 'debit', label: 'Money out' },
          { value: 'credit', label: 'Money in' },
        ]}
      />
      <label className="field" htmlFor="minimum-amount">
        <span>Minimum amount</span>
        <input
          disabled={disabled}
          id="minimum-amount"
          inputMode="decimal"
          value={filters.minAmount}
          onChange={(event) => update({ minAmount: event.target.value })}
          aria-invalid={!!errors.minAmount}
        />
        {errors.minAmount && (
          <small className="filter-error">{errors.minAmount}</small>
        )}
      </label>
      <label className="field" htmlFor="maximum-amount">
        <span>Maximum amount</span>
        <input
          disabled={disabled}
          id="maximum-amount"
          inputMode="decimal"
          value={filters.maxAmount}
          onChange={(event) => update({ maxAmount: event.target.value })}
          aria-invalid={!!errors.maxAmount}
        />
        {errors.maxAmount && (
          <small className="filter-error">{errors.maxAmount}</small>
        )}
      </label>
      <Picker
        disabled={disabled}
        label="Category"
        value={filters.category}
        onChange={(category) => update({ category })}
        options={[
          { value: 'all', label: 'All categories' },
          { value: 'review', label: 'Needs review' },
          ...data.categories.map((category) => ({
            value: category.id,
            label: category.name + (category.archived ? ' (archived)' : ''),
          })),
        ]}
      />
      <Picker
        disabled={disabled}
        label="Account"
        value={filters.account}
        onChange={(account) =>
          update(
            { account },
            filters.importGroup && account !== filters.account
              ? 'The import group was cleared because the account changed.'
              : '',
          )
        }
        options={[
          { value: 'all', label: 'All accounts' },
          ...accounts.map((account) => ({
            value: account.id,
            label: `${account.name}${account.archived ? ' (archived)' : ''}`,
          })),
        ]}
      />
      <label className="field" htmlFor="date-from">
        <span>From</span>
        <input
          disabled={disabled}
          id="date-from"
          type="date"
          value={filters.from}
          onChange={(event) => update({ from: event.target.value })}
          aria-invalid={!!errors.date}
        />
      </label>
      <label className="field" htmlFor="date-to">
        <span>To</span>
        <input
          disabled={disabled}
          id="date-to"
          type="date"
          value={filters.to}
          onChange={(event) => update({ to: event.target.value })}
          aria-invalid={!!errors.date}
        />
        {errors.date && <small className="filter-error">{errors.date}</small>}
      </label>
      <Picker
        disabled={disabled}
        label="Import group"
        value={filters.importGroup}
        onChange={(importGroup) => {
          const record = data.imports.find((item) => item.id === importGroup);
          const account =
            record &&
            data.accounts.find((item) => item.id === record.account_id);
          update(
            record
              ? {
                  importGroup,
                  account: record.account_id,
                  currency: account?.currency || currency,
                }
              : { importGroup: '' },
          );
        }}
        options={[
          { value: '', label: 'All imports' },
          ...data.imports.map((item) => {
            const account = data.accounts.find(
              (candidate) => candidate.id === item.account_id,
            );
            return {
              value: item.id,
              label: `${item.filename} · ${account?.name || 'Account'} · ${new Date(item.created_at).toLocaleString()}`,
            };
          }),
        ]}
      />
    </div>
  );
}
export default function Dashboard({
  accountsPage = false,
  categoriesPage = false,
}: {
  accountsPage?: boolean;
  categoriesPage?: boolean;
}) {
  const [showSidebar, setShowSidebar] = useState(true);
  const [data, setData] = useState<AppData>(initial),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState('');
  const [showImport, setShowImport] = useState(false),
    [raw, setRaw] = useState(''),
    [filename, setFilename] = useState(''),
    [csv, setCsv] = useState<CsvData | null>(null),
    [mapping, setMapping] = useState<Mapping | null>(null),
    [importError, setImportError] = useState('');
  const [target, setTarget] = useState('new'),
    [accountDraft, setAccountDraft] = useState<AccountDraft>(EMPTY_ACCOUNT);
  const [filters, setFilters] = useState<TransactionFilters>(
      DEFAULT_TRANSACTION_FILTERS,
    ),
    [page, setPage] = useState(0),
    [locationRevision, setLocationRevision] = useState(0);
  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);
  const [bulkOperation, setBulkOperation] = useState<BulkOperation | null>(
    null,
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [categorizeConfirmOpen, setCategorizeConfirmOpen] = useState(false);
  const [bulkController] = useState(
    () =>
      new BulkOperationController({
        request: async () => {
          throw new Error('Bulk operations are still initializing.');
        },
        normalize: () => {
          throw new Error('Bulk operations are still initializing.');
        },
        refresh: async () => {},
        committed: () => {},
        changed: () => {},
        uuid: () => crypto.randomUUID(),
      }),
  );
  const bulkLockedRef = useRef(false);
  const deferredLocation = useRef<string | null>(null);
  const pendingReviewOperations = useRef(new Map<string, string>());
  const pendingImportOperation = useRef<{ key: string; id: string } | null>(
    null,
  );
  const [currentImportId, setCurrentImportId] = useState<string | null>(null);
  const [monthlyPage, setMonthlyPage] = useState(false);
  const [spreadTransaction, setSpreadTransaction] = useState<Transaction | null>(null);
  const [spreadOpen, setSpreadOpen] = useState(false);
  const [mappingBusy, setMappingBusy] = useState(false),
    [mappingNote, setMappingNote] = useState('');
  const mappingGate = useRef(new MappingSuggestionGate());
  const mappingAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    const readLocation = () => {
      if (bulkLockedRef.current) {
        deferredLocation.current = window.location.href;
        setNotice(
          'Navigation will be applied after the sent bulk operation is resolved.',
        );
        return;
      }
      const params = new URLSearchParams(window.location.search);
      setCurrentImportId(
        params.get('view') === 'import' ? params.get('importId') : null,
      );
      setMonthlyPage(params.get('view') === 'monthly');
      setLocationRevision((revision) => revision + 1);
    };
    readLocation();
    window.addEventListener('popstate', readLocation);
    return () => window.removeEventListener('popstate', readLocation);
  }, []);
  const currency = filters.currency;
  const bulkLocked =
    bulkOperation?.status === 'running' ||
    bulkOperation?.status === 'unresolved';
  const updateFilters = useCallback(
    (change: Partial<TransactionFilters>, message = '') => {
      if (bulkLockedRef.current) return;
      setFilters((current) => {
        const next = { ...current, ...change };
        if (
          change.currency &&
          change.currency !== current.currency &&
          change.importGroup === undefined
        ) {
          next.account = 'all';
          next.importGroup = '';
        }
        if (
          change.account !== undefined &&
          change.account !== current.account &&
          current.importGroup &&
          change.importGroup === undefined
        ) {
          const group = data.imports.find(
            (item) => item.id === current.importGroup,
          );
          if (group && change.account !== group.account_id)
            next.importGroup = '';
        }
        if (transactionFiltersEqual(current, next)) return current;
        if (selectedIds.size) {
          setSelectedIds(new Set());
          message = [message, 'Selection cleared because the filters changed.']
            .filter(Boolean)
            .join(' ');
        }
        const params = filtersToSearchParams(
          next,
          new URLSearchParams(window.location.search),
        );
        window.history.replaceState({}, '', `/?${params.toString()}`);
        return next;
      });
      setPage(0);
      if (message) setNotice(message);
    },
    [data.imports, selectedIds.size],
  );
  const categoryLabel = (id: string) =>
    data.categories.find((c) => c.id === id)?.name || id;
  const openSpread = (transaction: Transaction) => { setSpreadTransaction(transaction); setSpreadOpen(true); };
  function changeMapping(value: Mapping) {
    mappingGate.current.invalidate();
    mappingAbort.current?.abort();
    mappingAbort.current = null;
    setMappingBusy(false);
    setMappingNote(
      'Mapping edited manually. Review the preview before saving.',
    );
    setMapping(value);
  }
  function invalidateMappingSuggestion(note = '') {
    mappingGate.current.invalidate();
    mappingAbort.current?.abort();
    mappingAbort.current = null;
    setMappingBusy(false);
    if (note) setMappingNote(note);
  }
  function changeImportTarget(value: string) {
    invalidateMappingSuggestion(
      csv
        ? 'Account context changed. Review the mapping or ask AI to check it again.'
        : '',
    );
    setTarget(value);
  }
  function changeAccountDraft(value: AccountDraft) {
    if (value.bank !== accountDraft.bank || value.type !== accountDraft.type)
      invalidateMappingSuggestion(
        csv
          ? 'Institution or account type changed. Review the mapping or ask AI to check it again.'
          : '',
      );
    setAccountDraft(value);
  }
  async function aiMapping(parsed: CsvData, run: number) {
    if (!data.aiReady) {
      setMappingNote(
        'AI unavailable. Review the suggested headers or map columns manually.',
      );
      return;
    }
    setMappingBusy(true);
    setMappingNote('AI is checking the columns and sample rows…');
    mappingAbort.current?.abort();
    const controller = new AbortController();
    mappingAbort.current = controller;
    const selected = data.accounts.find((a) => a.id === target);
    try {
      const result = await api<{
        mapping: Mapping;
        confidence: string;
        note: string;
      }>(
        'map-csv',
        'POST',
        {
          headers: parsed.headers,
          rows: selectRepresentativeRows(parsed).map((r) =>
            r.map((c) => c.slice(0, 500)),
          ),
          bank: selected?.bank || accountDraft.bank,
          accountType: selected?.type || accountDraft.type,
        },
        controller.signal,
      );
      if (!mappingGate.current.accepts(run)) return;
      setMapping(result.mapping);
      setMappingNote(
        `AI suggestion · ${result.confidence} confidence. ${result.note} Review before saving.`,
      );
    } catch (e) {
      if (mappingGate.current.accepts(run) && !controller.signal.aborted)
        setMappingNote(
          `${(e as Error).message} Your current mapping is preserved.`,
        );
    } finally {
      if (mappingGate.current.accepts(run)) {
        setMappingBusy(false);
        mappingAbort.current = null;
      }
    }
  }
  const refresh = useCallback(async () => {
    const result = await api<AppData>('data');
    const imports: AppData['imports'] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ limit: '100' });
      if (cursor) params.set('cursor', cursor);
      const page = await api<{
        items: AppData['imports'];
        nextCursor: string | null;
      }>(`imports?${params}`);
      imports.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    const complete = { ...result, imports };
    setData(complete);
    setSelectedIds((current) => {
      if (!current.size) return current;
      const matching = filterTransactions(
        complete.transactions,
        complete.accounts,
        filtersRef.current,
      ).filteredIds;
      const intersected = intersectTransactionSelection(current, matching);
      if (intersected.removed)
        setNotice(
          `${intersected.removed} selected transaction${intersected.removed === 1 ? ' was' : 's were'} removed because they are no longer available in this view.`,
        );
      return intersected.selection;
    });
    return complete;
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh()
        .then(async () => {
          const result = await api<{ seeded: number }>(
            'review-memory',
            'POST',
            { limit: 50 },
          );
          if (result.seeded) await refresh();
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    if (loading) return;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const parsed = filtersForLocation(
        params,
        data.accounts,
        data.imports,
        data.categories.map((category) => category.id),
      );
      const changed = !transactionFiltersEqual(
        filtersRef.current,
        parsed.filters,
      );
      if (changed && selectedIdsRef.current.size) {
        setSelectedIds(new Set());
        setNotice(
          [parsed.notice, 'Selection cleared because the filters changed.']
            .filter(Boolean)
            .join(' '),
        );
      } else if (parsed.notice) setNotice(parsed.notice);
      if (changed) {
        setFilters(parsed.filters);
        setPage(0);
      }
      const normalized = filtersToSearchParams(parsed.filters, params);
      if (
        normalized.toString() !==
        new URLSearchParams(window.location.search).toString()
      )
        window.history.replaceState({}, '', `/?${normalized.toString()}`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data.accounts, data.categories, data.imports, loading, locationRevision]);
  const preview = useMemo(
    () => (csv && mapping ? mapTransactions(csv, mapping) : null),
    [csv, mapping],
  );
  const accounts = data.accounts.filter((a) => a.currency === currency);
  const {
    filteredTransactions,
    filteredIds,
    filterValid,
    errors: filterErrors,
  } = useMemo(
    () => filterTransactions(data.transactions, data.accounts, filters),
    [data.accounts, data.transactions, filters],
  );
  const visible = filteredTransactions;
  const lastPage = Math.max(0, Math.ceil(visible.length / 25) - 1);
  const currentPage = Math.min(page, lastPage);
  const pageTransactions = visible.slice(
    currentPage * 25,
    currentPage * 25 + 25,
  );
  const pageIds = pageTransactions.map((transaction) => transaction.id);
  const pageSelection = pageSelectionState(selectedIds, pageIds);
  const selectedTransactions = data.transactions.filter((transaction) =>
    selectedIds.has(transaction.id),
  );
  const eligibleSelected = selectedTransactions.filter(
    isCategorizationEligible,
  );
  const protectedSelected =
    selectedTransactions.length - eligibleSelected.length;
  const rerunSelected = eligibleSelected.filter(
    (transaction) => transaction.source === 'ai',
  ).length;
  const reviewCount = filteredTransactions.filter(needsReview).length;
  const spending = data.categories
    .filter((c) => ['expense', 'unclassified'].includes(c.kind))
    .map((definition) => ({
      category: definition.id,
      amount: -filteredTransactions
        .filter(
          (t) =>
            t.category === definition.id &&
            !(definition.kind === 'unclassified' && t.amount > 0),
        )
        .reduce((n, t) => n + t.amount, 0),
    }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const spendingTotal = spending.reduce((n, c) => n + c.amount, 0);
  const colors = [
    '#145bdf',
    '#10a18f',
    '#8056d9',
    '#e5a92f',
    '#e56371',
    '#7d91aa',
  ];
  const chartSegments = spending
    .map((s, i) => {
      const start =
        (spending.slice(0, i).reduce((n, x) => n + x.amount, 0) /
          spendingTotal) *
        100;
      return `${colors[i % colors.length]} ${start}% ${start + (s.amount / spendingTotal) * 100}%`;
    })
    .join(',');
  const controllerHandlers = {
    request: (kind: 'delete' | 'categorize', payload: unknown) =>
      api(
        kind === 'delete' ? 'transactions/delete' : 'categorize',
        'POST',
        payload,
      ),
    normalize: (
      kind: 'delete' | 'categorize',
      ids: readonly string[],
      rawResult: unknown,
    ): BulkOutcome => {
      const result = rawResult as Record<string, unknown>;
      const lists =
        kind === 'delete'
          ? [result.deletedIds, result.unavailableIds]
          : [result.categorizedIds, result.protectedIds, result.unavailableIds];
      if (lists.some((list) => !Array.isArray(list))) {
        const error = new Error(
          'The success response was incomplete. Recover the sent batch before continuing.',
        ) as Error & { certainty?: 'unresolved' };
        error.certainty = 'unresolved';
        throw error;
      }
      const outcomes = lists.flat() as string[];
      if (
        outcomes.length !== ids.length ||
        new Set(outcomes).size !== outcomes.length ||
        outcomes.some((id) => !ids.includes(id))
      ) {
        const error = new Error(
          'The success response did not account for every transaction. Recover the sent batch before continuing.',
        ) as Error & { certainty?: 'unresolved' };
        error.certainty = 'unresolved';
        throw error;
      }
      const deletedIds = (result.deletedIds as string[] | undefined) || [];
      const categorizedIds =
        (result.categorizedIds as string[] | undefined) || [];
      const protectedIds = (result.protectedIds as string[] | undefined) || [];
      const unavailableIds = (result.unavailableIds as string[]) || [];
      return {
        resolvedIds: outcomes,
        deletedIds,
        categorizedIds,
        protectedIds,
        unavailableIds,
        deleted: deletedIds.length,
        categorized: categorizedIds.length,
        protected: protectedIds.length,
        unavailable: unavailableIds.length,
      };
    },
    refresh,
    committed: (
      kind: 'delete' | 'categorize',
      ids: readonly string[],
      outcome: BulkOutcome,
    ) => {
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      });
      if (kind === 'delete' && outcome.deletedIds?.length)
        setData((current) => ({
          ...current,
          transactions: current.transactions.filter(
            (transaction) => !outcome.deletedIds!.includes(transaction.id),
          ),
        }));
    },
    changed: (operation: BulkOperation | null) => {
      const locked =
        operation?.status === 'running' || operation?.status === 'unresolved';
      bulkLockedRef.current = locked;
      setBulkOperation(operation);
      if (operation?.status === 'completed')
        setNotice(
          operation.kind === 'delete'
            ? `${operation.deleted} transaction${operation.deleted === 1 ? '' : 's'} deleted.${operation.unavailable ? ` ${operation.unavailable} ${operation.unavailable === 1 ? 'was' : 'were'} already unavailable.` : ''} Import and review history was kept.`
            : `${operation.categorized} transaction${operation.categorized === 1 ? '' : 's'} categorized.${operation.protected ? ` ${operation.protected} protected ${operation.protected === 1 ? 'transaction was' : 'transactions were'} skipped.` : ''}${operation.unavailable ? ` ${operation.unavailable} ${operation.unavailable === 1 ? 'was' : 'were'} unavailable.` : ''} Review AI suggestions before accepting them.`,
        );
      if (!locked && deferredLocation.current) {
        deferredLocation.current = null;
        const params = new URLSearchParams(window.location.search);
        setCurrentImportId(
          params.get('view') === 'import' ? params.get('importId') : null,
        );
        setLocationRevision((revision) => revision + 1);
      }
    },
    uuid: () => crypto.randomUUID(),
  };
  useEffect(() => {
    bulkController.setHandlers(controllerHandlers);
  });

  function runDeletion(capturedIds: readonly string[]) {
    setDeleteConfirmOpen(false);
    setError('');
    bulkController.start('delete', capturedIds);
  }
  function selectedInFilterOrder() {
    return filteredIds.filter((id) => selectedIds.has(id));
  }
  function editSelection(update: (current: Set<string>) => Set<string>) {
    if (bulkLockedRef.current) return;
    setSelectedIds(update);
  }
  async function reviewTransaction(
    transaction: Transaction,
    category: Category,
    action: 'correct' | 'confirm' | 'memory_enable' | 'memory_disable',
    learn: boolean,
  ) {
    if (bulkLockedRef.current) return;
    setError('');
    setBusy('category');
    const operationKey = `${transaction.id}:${category}:${action}:${learn}:${transaction.category_revision}`;
    const operationId =
      pendingReviewOperations.current.get(operationKey) || crypto.randomUUID();
    pendingReviewOperations.current.set(operationKey, operationId);
    try {
      const saved = await api<{
        category: string;
        source?: string;
        confidence?: string | null;
        memoryEnabled: boolean;
        categoryRevision: number;
        reviewedAt: string | null;
      }>('category', 'PATCH', {
        id: transaction.id,
        category,
        action,
        learn,
        operationId,
        expectedRevision: transaction.category_revision,
      });
      pendingReviewOperations.current.delete(operationKey);
      const reviewedTransaction = {
        ...transaction,
        category: saved.category,
        source: saved.source ?? transaction.source,
        confidence:
          saved.confidence === undefined
            ? transaction.confidence
            : saved.confidence,
        category_revision: saved.categoryRevision,
        reviewed_at: saved.reviewedAt,
        has_review: true,
        memory_enabled: saved.memoryEnabled ? 1 : 0,
        categorization_evidence:
          action === 'correct' || action === 'confirm'
            ? null
            : transaction.categorization_evidence,
      };
      setData((d) => ({
        ...d,
        transactions: d.transactions.map((t) =>
          t.id === transaction.id ? reviewedTransaction : t,
        ),
      }));
      if (
        selectedIds.has(transaction.id) &&
        !filterTransactions([reviewedTransaction], data.accounts, filters)
          .filteredIds.length
      ) {
        setSelectedIds((current) =>
          toggleTransaction(current, transaction.id, false),
        );
        setNotice(
          'The reviewed transaction was removed from the selection because it no longer matches the filters.',
        );
      } else {
        setNotice('Category accepted and available for future categorization.');
      }
    } catch (e) {
      setError((e as Error).message);
      if ((e as Error).message.includes('changed'))
        await refresh().catch(() => undefined);
    } finally {
      setBusy('');
    }
  }
  useEffect(() => {
    const ctx = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!ctx?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(
        ctx.registerTool(
          {
            name: 'start_bank_csv_import',
            title: 'Start account CSV import',
            description:
              'Open the account CSV import dialog. Does not upload or save any data. The user chooses a file and reviews it before saving.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: false },
            execute: (input: unknown) => {
              if (
                !input ||
                typeof input !== 'object' ||
                Object.keys(input).length
              )
                throw new Error('Expected an empty object.');
              if (bulkLockedRef.current)
                throw new Error(
                  'Finish recovering the current bulk operation before importing.',
                );
              setShowImport(true);
              return { opened: true, saved: false };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, []);
  async function loadFile(file?: File) {
    if (busy || bulkLockedRef.current) return;
    invalidateMappingSuggestion();
    const run = mappingGate.current.begin();
    setMappingNote('');
    setImportError('');
    setCsv(null);
    setMapping(null);
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setImportError('Choose a .csv transaction export.');
      return;
    }
    if (file.size > 5_000_000) {
      setImportError('Choose a file smaller than 5 MB.');
      return;
    }
    try {
      const text = await file.text();
      if (!mappingGate.current.accepts(run)) return;
      const parsed = parseCsv(text);
      setRaw(text);
      setFilename(file.name);
      setCsv(parsed);
      setMapping(suggestMapping(parsed.headers));
      void aiMapping(parsed, run);
    } catch (e) {
      setImportError((e as Error).message);
    }
  }
  function startImport(account?: Account) {
    if (busy || bulkLockedRef.current) return;
    invalidateMappingSuggestion();
    setMappingNote('');
    setImportError('');
    setTarget(account?.id || 'new');
    setCsv(null);
    setMapping(null);
    setRaw('');
    setFilename('');
    setAccountDraft(
      account
        ? {
            bank: account.bank,
            name: '',
            type: account.type,
            currency: account.currency,
          }
        : EMPTY_ACCOUNT,
    );
    if (account) {
      updateFilters({ currency: account.currency });
    }
    setShowImport(true);
  }
  async function saveImport() {
    if (bulkLockedRef.current) return;
    setBusy('import');
    setImportError('');
    try {
      const requestPayload = {
        csv: raw,
        filename,
        mapping,
        accountId: target === 'new' ? null : target,
        account: { ...accountDraft },
      };
      const requestKey = JSON.stringify(requestPayload);
      const operationId =
        pendingImportOperation.current?.key === requestKey
          ? pendingImportOperation.current.id
          : crypto.randomUUID();
      pendingImportOperation.current = { key: requestKey, id: operationId };
      const r = await api<{
        importId: string;
        accountId: string;
        currency: string;
        added: number;
        skipped: number;
        enriched: number;
      }>('import', 'POST', { ...requestPayload, operationId });
      pendingImportOperation.current = null;
      await refresh();
      setShowImport(false);
      const importedFilters: TransactionFilters = {
        ...DEFAULT_TRANSACTION_FILTERS,
        currency: r.currency,
        account: r.accountId,
        importGroup: r.importId,
      };
      setFilters(importedFilters);
      const params = filtersToSearchParams(
        importedFilters,
        new URLSearchParams({ view: 'import', importId: r.importId }),
      );
      const nextUrl = `/?${params.toString()}`;
      window.history.pushState({}, '', nextUrl);
      setCurrentImportId(r.importId);
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  function categorize(capturedIds: readonly string[]) {
    setCategorizeConfirmOpen(false);
    setError('');
    bulkController.start('categorize', capturedIds);
  }
  if (monthlyPage)
    return <><AppNavbar active="monthly" navigationLocked={bulkLocked} /><MonthlyExpenses data={data} onRefresh={refresh} api={api} /></>;
  if (currentImportId)
    return (
      <div className="app-shell">
        <AppNavbar active="transactions" navigationLocked={bulkLocked} />
        <div className="page-scroll">
          <ImportResults
            importId={currentImportId}
            navigationLocked={bulkLocked}
          >
            <section className="section transaction-panel import-transaction-panel">
              {error && (
                <div className="message error" role="alert">
                  {error}
                </div>
              )}
              {notice && (
                <output className="message success">
                  <CheckCircle2 size={18} />
                  {notice}
                  <button
                    onClick={() => setNotice('')}
                    aria-label="Dismiss notification"
                  >
                    ×
                  </button>
                </output>
              )}
              <div className="transaction-heading">
                <div>
                  <h2>
                    {filters.importGroup === currentImportId
                      ? 'New transactions '
                      : 'Transactions '}
                    <span className="count">{visible.length}</span>
                  </h2>
                  <p className="subtle">
                    {filters.importGroup === currentImportId
                      ? 'Transactions added by this import and still available.'
                      : 'The historical import report remains open; the table follows your current filters.'}
                  </p>
                </div>
                <div className="results-table-actions">
                  <button
                    className="secondary"
                    disabled={
                      bulkLocked ||
                      JSON.stringify(filters) ===
                        JSON.stringify({
                          ...DEFAULT_TRANSACTION_FILTERS,
                          currency,
                        })
                    }
                    onClick={() =>
                      updateFilters({
                        ...DEFAULT_TRANSACTION_FILTERS,
                        currency,
                      })
                    }
                  >
                    Clear filters
                  </button>
                  <Link
                    className="secondary-link"
                    href={`/?${filtersToSearchParams(filters, new URLSearchParams({ view: 'transactions' })).toString()}`}
                    aria-disabled={bulkLocked}
                    onClick={(event) => {
                      if (bulkLocked) event.preventDefault();
                    }}
                  >
                    Open full transaction view
                  </Link>
                </div>
              </div>
              <TransactionFilterControls
                disabled={bulkLocked}
                filters={filters}
                errors={filterErrors}
                data={data}
                accounts={accounts}
                update={updateFilters}
              />
              {!filterValid && (
                <div className="message error" role="alert">
                  Correct the filter values to show transactions.
                </div>
              )}
              <TransactionSelectionToolbar
                selectedCount={selectedIds.size}
                matchingCount={filteredIds.length}
                eligibleCount={eligibleSelected.length}
                protectedCount={protectedSelected}
                rerunCount={rerunSelected}
                aiReady={data.aiReady}
                operation={bulkOperation}
                deleteConfirmOpen={deleteConfirmOpen}
                categorizeConfirmOpen={categorizeConfirmOpen}
                onDeleteConfirmOpenChange={setDeleteConfirmOpen}
                onCategorizeConfirmOpenChange={setCategorizeConfirmOpen}
                onSelectAll={() =>
                  editSelection(() => captureMatchingTransactions(filteredIds))
                }
                onClear={() => {
                  setSelectedIds(new Set());
                }}
                onDelete={() => runDeletion(selectedInFilterOrder())}
                onCategorize={() => categorize(selectedInFilterOrder())}
                onStop={() => bulkController.stop()}
                onRetry={() => void bulkController.resume()}
                onRecover={() => bulkController.recover()}
                onRetryRefresh={() => bulkController.retryRefresh()}
                onAbandon={() => bulkController.abandon()}
              />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="selection-cell">
                      <Checkbox
                        aria-label="Select all transactions on this page"
                        checked={pageSelection.checked}
                        indeterminate={pageSelection.indeterminate}
                        disabled={bulkLocked || !pageIds.length}
                        onCheckedChange={(checked) =>
                          editSelection((current) =>
                            toggleTransactionPage(
                              current,
                              pageIds,
                              checked === true,
                            ),
                          )
                        }
                      />
                    </TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Sub-description</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageTransactions.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell className="selection-cell">
                        <Checkbox
                          aria-label={`Select ${transaction.description} on ${transaction.date}`}
                          checked={selectedIds.has(transaction.id)}
                          disabled={bulkLocked}
                          onCheckedChange={(checked) =>
                            editSelection((current) =>
                              toggleTransaction(
                                current,
                                transaction.id,
                                checked === true,
                              ),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="date-cell">
                        {transaction.date}
                      </TableCell>
                      <TableCell className="description-cell">
                        <div>{transaction.description}</div>
                        {transaction.spread_start_month && (
                          <button className="spread-label" onClick={() => openSpread(transaction)}>
                            Spread · {transaction.spread_month_count} months
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="sub-description-cell">
                        {transaction.sub_description || (
                          <span className="subtle">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="subtle">
                          {
                            data.accounts.find(
                              (account) =>
                                account.id === transaction.account_id,
                            )?.name
                          }
                        </span>
                      </TableCell>
                      <TableCell>
                        {categoryLabel(transaction.category)}
                      </TableCell>
                      <TableCell
                        className={
                          'right amount ' +
                          (transaction.amount > 0 ? 'income' : '')
                        }
                      >
                        {transaction.amount > 0 ? '+' : ''}
                        {money(transaction.amount, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!visible.length && (
                <div className="small-empty">
                  No new transactions remain from this import. Matching rows are
                  still shown above.
                </div>
              )}
              <div className="table-footer">
                <span>
                  {visible.length
                    ? `${currentPage * 25 + 1}–${Math.min(currentPage * 25 + 25, visible.length)} of ${visible.length}`
                    : '0 transactions'}
                </span>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Previous page"
                    disabled={currentPage === 0}
                    onClick={() => setPage(Math.max(0, currentPage - 1))}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Next page"
                    disabled={(currentPage + 1) * 25 >= visible.length}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            </section>
          </ImportResults>
        </div>
      </div>
    );
  return (
    <div className="app-shell">
      <AppNavbar
        active={
          accountsPage
            ? 'accounts'
            : categoriesPage
              ? 'categories'
              : 'transactions'
        }
        navigationLocked={bulkLocked}
      />
      <div
        className={
          !accountsPage && !categoriesPage
            ? `transaction-page-layout ${showSidebar ? 'sidebar-expanded' : 'sidebar-collapsed'}`
            : 'page-scroll'
        }
      >
        <main
          className={
            !accountsPage && !categoriesPage ? 'transactions-page' : undefined
          }
        >
          <div
            className={
              accountsPage || categoriesPage ? 'page-heading' : 'page-actions'
            }
          >
            {(accountsPage || categoriesPage) && (
              <div>
                <h1>{accountsPage ? 'Accounts' : 'Categories'}</h1>
                <p className="subtle">
                  {accountsPage
                    ? 'Manage your accounts and import transactions.'
                    : 'Create and rename categories, or archive ones you no longer use.'}
                </p>
              </div>
            )}
            {!categoriesPage && (
              <button
                className="primary import-csv-button"
                onClick={() => startImport()}
                disabled={loading || !!busy || bulkLocked}
              >
                <Upload size={15} /> Import CSV
              </button>
            )}
          </div>
          {error && (
            <div className="message error" role="alert">
              {error}
              <button
                onClick={() => {
                  setError('');
                  setLoading(true);
                  refresh()
                    .catch((e) => setError(e.message))
                    .finally(() => setLoading(false));
                }}
              >
                Retry
              </button>
            </div>
          )}
          {notice && (
            <output className="message success">
              <CheckCircle2 size={18} />
              {notice}
              <button
                onClick={() => setNotice('')}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </output>
          )}
          {categoriesPage ? (
            loading ? (
              <output className="subtle">Loading categories…</output>
            ) : !error ? (
              <CategoryManager categories={data.categories} onSaved={refresh} />
            ) : null
          ) : accountsPage ? (
            <>
              <AccountManager
                accounts={data.accounts}
                transactionAccountIds={
                  new Set([
                    ...data.transactions.map(
                      (transaction) => transaction.account_id,
                    ),
                    ...data.imports.map((record) => record.account_id),
                  ])
                }
                busy={loading || !!busy || bulkLocked}
                request={(method, payload) => api('account', method, payload)}
                onChanged={refresh}
                onImport={startImport}
                onNotice={setNotice}
                onError={setError}
              />
              <ImportHistory
                initial={data.imports}
                navigationLocked={bulkLocked}
              />
            </>
          ) : (
            <>
              {!loading && !data.transactions.length ? (
                <Empty className="empty-panel">
                  <EmptyHeader>
                    <Upload size={30} />
                    <EmptyTitle className="empty-title">
                      Start with a transaction export
                    </EmptyTitle>
                    <EmptyDescription>
                      Upload a CSV to bring your accounts and transactions into
                      view. You’ll review the columns and amounts before saving.
                    </EmptyDescription>
                  </EmptyHeader>
                  <button className="primary" onClick={() => startImport()}>
                    <Upload size={16} /> Import your first CSV
                  </button>
                  <p className="privacy">
                    <LockKeyhole size={14} /> Saved in your private cloud
                    workspace
                  </p>
                </Empty>
              ) : (
                <>
                  <section className="section transaction-panel">
                    <div className="transaction-heading">
                      <div>
                        <h2>
                          Transactions{' '}
                          <span className="count">{visible.length}</span>
                        </h2>
                        <p className="subtle">
                          Change any category to correct it.
                        </p>
                      </div>
                      {reviewCount > 0 && (
                        <button
                          className="review-link"
                          disabled={bulkLocked}
                          onClick={() => updateFilters({ category: 'review' })}
                        >
                          {reviewCount} transactions to review{' '}
                          <ArrowRight size={15} />
                        </button>
                      )}
                    </div>
                    {filters.category !== 'all' && (
                      <div className="active-category-filter">
                        <span>
                          Category:{' '}
                          <strong>
                            {filters.category === 'review'
                              ? 'Needs review'
                              : categoryLabel(filters.category)}
                          </strong>
                        </span>
                        <button
                          className="text-button"
                          disabled={bulkLocked}
                          onClick={() => updateFilters({ category: 'all' })}
                        >
                          View all categories
                        </button>
                      </div>
                    )}
                    {!filterValid && (
                      <div className="message error" role="alert">
                        Correct the filter values to show transactions.
                      </div>
                    )}
                    <TransactionSelectionToolbar
                      selectedCount={selectedIds.size}
                      matchingCount={filteredIds.length}
                      eligibleCount={eligibleSelected.length}
                      protectedCount={protectedSelected}
                      rerunCount={rerunSelected}
                      aiReady={data.aiReady}
                      operation={bulkOperation}
                      deleteConfirmOpen={deleteConfirmOpen}
                      categorizeConfirmOpen={categorizeConfirmOpen}
                      onDeleteConfirmOpenChange={setDeleteConfirmOpen}
                      onCategorizeConfirmOpenChange={setCategorizeConfirmOpen}
                      onSelectAll={() =>
                        editSelection(() =>
                          captureMatchingTransactions(filteredIds),
                        )
                      }
                      onClear={() => {
                        setSelectedIds(new Set());
                      }}
                      onDelete={() => runDeletion(selectedInFilterOrder())}
                      onCategorize={() => categorize(selectedInFilterOrder())}
                      onStop={() => bulkController.stop()}
                      onRetry={() => void bulkController.resume()}
                      onRecover={() => bulkController.recover()}
                      onRetryRefresh={() => bulkController.retryRefresh()}
                      onAbandon={() => bulkController.abandon()}
                    />
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="selection-cell">
                            <Checkbox
                              aria-label="Select all transactions on this page"
                              checked={pageSelection.checked}
                              indeterminate={pageSelection.indeterminate}
                              disabled={bulkLocked || !pageIds.length}
                              onCheckedChange={(checked) =>
                                editSelection((current) =>
                                  toggleTransactionPage(
                                    current,
                                    pageIds,
                                    checked === true,
                                  ),
                                )
                              }
                            />
                          </TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Sub-description</TableHead>
                          <TableHead>Account</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead className="right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pageTransactions.map((t) => (
                          <TableRow key={t.id}>
                            <TableCell className="selection-cell">
                              <Checkbox
                                aria-label={`Select ${t.description} on ${t.date}`}
                                checked={selectedIds.has(t.id)}
                                disabled={bulkLocked}
                                onCheckedChange={(checked) =>
                                  editSelection((current) =>
                                    toggleTransaction(
                                      current,
                                      t.id,
                                      checked === true,
                                    ),
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell className="date-cell">
                              {t.date}
                            </TableCell>
                      <TableCell className="description-cell">
                        <div>{t.description}</div>
                        {t.spread_start_month && (
                          <button className="spread-label" onClick={() => openSpread(t)}>
                            Spread · {t.spread_month_count} months
                          </button>
                        )}
                            </TableCell>
                            <TableCell className="sub-description-cell">
                              {t.sub_description || (
                                <span className="subtle">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <span className="subtle">
                                {
                                  data.accounts.find(
                                    (a) => a.id === t.account_id,
                                  )?.name
                                }
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="category-cell">
                                <div className="category-row">
                                  <NativeSelect
                                    value={t.category}
                                    aria-label={`Category for ${t.description} on ${t.date}`}
                                    disabled={!!busy || bulkLocked}
                                    onChange={(e) => {
                                      const next = e.target.value as Category;
                                      void reviewTransaction(
                                        t,
                                        next,
                                        next === t.category
                                          ? 'confirm'
                                          : 'correct',
                                        true,
                                      );
                                    }}
                                  >
                                    {data.categories
                                      .filter(
                                        (c) =>
                                          !c.archived || c.id === t.category,
                                      )
                                      .map((c) => (
                                        <option key={c.id} value={c.id}>
                                          {c.name}
                                          {c.archived ? ' (archived)' : ''}
                                        </option>
                                      ))}
                                  </NativeSelect>
                                  {t.source === 'ai' && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger
                                          className={
                                            'ai-status-icon ' +
                                            (t.confidence === 'high'
                                              ? ''
                                              : 'needs-review')
                                          }
                                          aria-label={
                                            t.confidence === 'high'
                                              ? 'AI suggestion, high confidence'
                                              : `Review AI suggestion, ${t.confidence || 'low'} confidence`
                                          }
                                        >
                                          <Sparkles size={15} />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          {t.confidence === 'high'
                                            ? 'AI suggestion · high confidence'
                                            : `Review AI suggestion · ${t.confidence || 'low'} confidence`}
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                  {t.source === 'manual' && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger
                                          className="reviewed-icon"
                                          aria-label="Reviewed category"
                                        >
                                          <CheckCircle2 size={15} />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          Reviewed category
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                  <DropdownMenu>
                                    <DropdownMenuTrigger
                                      className="row-menu-trigger"
                                      aria-label={`Actions for ${t.description} on ${t.date}`}
                                      disabled={!!busy || bulkLocked}
                                    >
                                      <MoreHorizontal size={17} />
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                      align="end"
                                      className="row-actions-menu"
                                    >
                                      <DropdownMenuItem onClick={() => openSpread(t)}>
                                        {t.spread_start_month ? 'Edit spread' : 'Spread across months'}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() =>
                                          void reviewTransaction(
                                            t,
                                            t.category,
                                            'confirm',
                                            true,
                                          )
                                        }
                                      >
                                        <CheckCircle2 /> Accept category
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                                {t.source === 'ai' &&
                                  t.categorization_evidence &&
                                  (() => {
                                    let evidence: CategorizationEvidence[] = [];
                                    try {
                                      evidence = JSON.parse(
                                        t.categorization_evidence,
                                      );
                                    } catch {}
                                    return evidence.length ? (
                                      <details className="ai-evidence">
                                        <summary>
                                          AI cited your previous reviews
                                        </summary>
                                        {evidence.map((item) => (
                                          <p key={item.memoryId}>
                                            {item.description}
                                            {item.subDescription
                                              ? ` · ${item.subDescription}`
                                              : ''}{' '}
                                            → {item.categoryName}
                                            {item.reviewedTransactionCount > 1
                                              ? ` (${item.reviewedTransactionCount} reviews)`
                                              : ''}
                                          </p>
                                        ))}
                                      </details>
                                    ) : null;
                                  })()}
                              </div>
                            </TableCell>
                            <TableCell
                              className={
                                'right amount ' + (t.amount > 0 ? 'income' : '')
                              }
                            >
                              {t.amount > 0 ? '+' : ''}
                              {money(t.amount, currency)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {!visible.length && (
                      <div className="small-empty">
                        No transactions match this selection.
                      </div>
                    )}
                    <div className="table-footer">
                      <span>
                        {visible.length
                          ? `${currentPage * 25 + 1}–${Math.min(currentPage * 25 + 25, visible.length)} of ${visible.length}`
                          : '0 transactions'}
                      </span>
                      <div>
                        <button
                          className="icon-button"
                          aria-label="Previous page"
                          disabled={currentPage === 0}
                          onClick={() => setPage(Math.max(0, currentPage - 1))}
                        >
                          <ChevronLeft size={18} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label="Next page"
                          disabled={(currentPage + 1) * 25 >= visible.length}
                          onClick={() => setPage(currentPage + 1)}
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                    </div>
                  </section>
                </>
              )}
            </>
          )}
          <footer className="page-footer">
            <ShieldCheck size={14} />
            <span>
              Private to your signed-in account. Transactions are added with
              manual CSV imports.
            </span>
          </footer>
        </main>
        {!accountsPage && !categoriesPage && (
          <aside
            id="transaction-sidebar"
            className="transaction-sidebar"
            aria-label="Transaction tools"
          >
            <div className="sidebar-rail">
              <button
                className="icon-button sidebar-toggle"
                aria-label={showSidebar ? 'Collapse sidebar' : 'Expand sidebar'}
                title={showSidebar ? 'Collapse sidebar' : 'Expand sidebar'}
                aria-expanded={showSidebar}
                aria-controls="sidebar-content"
                onClick={() => setShowSidebar((shown) => !shown)}
              >
                {showSidebar ? (
                  <PanelRightClose size={20} />
                ) : (
                  <PanelRightOpen size={20} />
                )}
              </button>
            </div>
            <div
              id="sidebar-content"
              className="sidebar-content"
              hidden={!showSidebar}
            >
              <Tabs defaultValue="breakdown">
                <TabsList
                  className="sidebar-tabs"
                  aria-label="Transaction tools"
                >
                  <TabsTrigger value="breakdown">
                    <ChartPie size={16} /> Breakdown
                  </TabsTrigger>
                  <TabsTrigger value="filters">
                    <SlidersHorizontal size={16} /> Filters
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="breakdown">
                  <div className="analysis-header">
                    <div>
                      <h2>Transaction breakdown</h2>
                      <p className="subtle">
                        Totals follow your categories. Review transfers and
                        refunds for accuracy.
                      </p>
                    </div>
                  </div>
                  {filters.category !== 'all' && (
                    <button
                      className="text-button breakdown-reset"
                      disabled={bulkLocked}
                      onClick={() => updateFilters({ category: 'all' })}
                    >
                      View all categories
                    </button>
                  )}
                  <div className="analysis-grid">
                    <section className="spending-panel">
                      <div className="section-heading">
                        <h3>Where your money goes</h3>
                        <span className="subtle">{currency}</span>
                      </div>
                      {spending.length ? (
                        <div className="spending-content">
                          <figure
                            className="donut"
                            style={{
                              background: `conic-gradient(${chartSegments})`,
                            }}
                            aria-label="Spending by category, detailed in the adjacent list"
                          >
                            <div>
                              <span>Transaction outflow</span>
                              <strong>{money(spendingTotal, currency)}</strong>
                            </div>
                          </figure>
                          <div className="legend">
                            {spending.map((s, i) => (
                              <button
                                className="legend-row"
                                key={s.category}
                                disabled={bulkLocked}
                                aria-pressed={filters.category === s.category}
                                onClick={() =>
                                  updateFilters({ category: s.category })
                                }
                              >
                                <span className="legend-label">
                                  <i
                                    style={{
                                      background: colors[i % colors.length],
                                    }}
                                  />
                                  {categoryLabel(s.category)}
                                </span>
                                <strong>{money(s.amount, currency)}</strong>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="small-empty">
                          No spending in this selection.
                        </div>
                      )}
                    </section>
                  </div>
                </TabsContent>
                <TabsContent value="filters">
                  <div className="sidebar-filter-heading">
                    <h2>Filters</h2>
                    <button
                      className="secondary"
                      disabled={
                        bulkLocked ||
                        JSON.stringify(filters) ===
                          JSON.stringify({
                            ...DEFAULT_TRANSACTION_FILTERS,
                            currency,
                          })
                      }
                      onClick={() =>
                        updateFilters({
                          ...DEFAULT_TRANSACTION_FILTERS,
                          currency,
                        })
                      }
                    >
                      Clear filters
                    </button>
                  </div>
                  <TransactionFilterControls
                    disabled={bulkLocked}
                    filters={filters}
                    errors={filterErrors}
                    data={data}
                    accounts={accounts}
                    update={updateFilters}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </aside>
        )}
      </div>
      <Dialog
        open={showImport}
        onOpenChange={(v) => {
          if (busy !== 'import' && !bulkLocked) {
            setShowImport(v);
            if (!v) {
              invalidateMappingSuggestion();
            }
          }
        }}
      >
        <DialogContent className="import-dialog">
          <DialogHeader>
            <DialogTitle className="dialog-title">
              Import transactions
            </DialogTitle>
            <DialogDescription>
              Choose one account per CSV. Review the preview, then save to your
              private workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="dialog-scroll">
            <Picker
              label="Import into"
              value={target}
              onChange={changeImportTarget}
              options={[
                { value: 'new', label: 'Create a new account' },
                ...data.accounts
                  .filter((a) => !a.archived)
                  .map((a) => ({
                    value: a.id,
                    label: `${a.bank} · ${a.name} (${a.currency})`,
                  })),
              ]}
            />
            {target === 'new' && (
              <AccountFields
                value={accountDraft}
                onChange={changeAccountDraft}
              />
            )}
            <label className="upload-zone">
              <FileSpreadsheet size={28} />
              <strong>{filename || 'Choose a CSV export'}</strong>
              <span>CSV from any institution · up to 2,000 rows · 5 MB</span>
              <span>
                AI uses headers and up to five representative sample rows to
                suggest a mapping.
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => void loadFile(e.target.files?.[0])}
                disabled={!!busy || bulkLocked}
              />
            </label>
            {csv && mapping && (
              <>
                <div className="mapping-heading">
                  <h3>Match your columns</h3>
                  <button
                    className="text-button"
                    disabled={mappingBusy || !data.aiReady}
                    onClick={() =>
                      void aiMapping(csv, mappingGate.current.begin())
                    }
                  >
                    <Sparkles size={14} />
                    {mappingBusy ? 'Mapping…' : 'Suggest with AI'}
                  </button>
                  <span className="subtle">{csv.rows.length} rows found</span>
                </div>
                {mappingNote && (
                  <output className="mapping-status">
                    {mappingBusy && <LoaderCircle size={15} className="spin" />}
                    {mappingNote}
                  </output>
                )}
                <div className="form-grid">
                  {(['date', 'description', 'subDescription'] as const).map(
                    (key) => (
                      <Picker
                        key={key}
                        label={
                          key === 'date'
                            ? 'Transaction date'
                            : key === 'subDescription'
                              ? 'Sub-description (optional)'
                              : 'Description'
                        }
                        value={mapping[key] || ''}
                        onChange={(v) =>
                          changeMapping({ ...mapping, [key]: v })
                        }
                        options={[
                          {
                            value: '',
                            label:
                              key === 'subDescription'
                                ? 'Not mapped'
                                : 'Choose column',
                          },
                          ...opts(csv.headers),
                        ]}
                      />
                    ),
                  )}
                  <Picker
                    label="Amount layout"
                    value={mapping.mode}
                    onChange={(v) =>
                      changeMapping({ ...mapping, mode: v as Mapping['mode'] })
                    }
                    options={[
                      { value: 'signed', label: 'One signed amount column' },
                      {
                        value: 'split',
                        label: 'Separate debit & credit columns',
                      },
                    ]}
                  />
                  <Picker
                    label="Date format"
                    value={mapping.dateFormat}
                    onChange={(v) =>
                      changeMapping({
                        ...mapping,
                        dateFormat: v as Mapping['dateFormat'],
                      })
                    }
                    options={[
                      { value: 'YMD', label: 'YYYY-MM-DD (or named month)' },
                      { value: 'MDY', label: 'MM/DD/YYYY' },
                      { value: 'DMY', label: 'DD/MM/YYYY' },
                    ]}
                  />
                  {(mapping.mode === 'signed'
                    ? ['amount']
                    : ['debit', 'credit']
                  ).map((key) => (
                    <Picker
                      key={key}
                      label={key[0].toUpperCase() + key.slice(1)}
                      value={mapping[key as 'amount' | 'debit' | 'credit']}
                      onChange={(v) => changeMapping({ ...mapping, [key]: v })}
                      options={[
                        { value: '', label: 'Choose column' },
                        ...opts(csv.headers),
                      ]}
                    />
                  ))}
                  <Picker
                    label="Amount direction"
                    value={mapping.sign}
                    onChange={(v) =>
                      changeMapping({ ...mapping, sign: v as Mapping['sign'] })
                    }
                    options={[
                      {
                        value: 'normal',
                        label: 'Standard: money out is negative',
                      },
                      {
                        value: 'reverse',
                        label: 'Reverse all signs (e.g. card charges positive)',
                      },
                    ]}
                  />
                </div>
                <div className="preview-heading">
                  <h3>Review before saving</h3>
                  <p className="subtle">
                    Spending should be negative; income and refunds positive.
                  </p>
                </div>
                {preview && preview.errors.length > 0 && (
                  <div className="message error">
                    <div>
                      {preview.errors.slice(0, 4).map((e, i) => (
                        <p key={i}>{e}</p>
                      ))}
                      {preview.errors.length > 4 && (
                        <p>+ {preview.errors.length - 4} more errors</p>
                      )}
                      <p>
                        Fix the mapping or CSV before importing. No rows will be
                        silently dropped.
                      </p>
                    </div>
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview?.transactions.slice(0, 5).map((t, i) => (
                      <TableRow key={i}>
                        <TableCell>{t.date}</TableCell>
                        <TableCell className="description-cell">
                          {t.description}
                          {t.subDescription && (
                            <p className="sub-description">
                              {t.subDescription}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="right amount">
                          {money(
                            t.amount,
                            target === 'new'
                              ? accountDraft.currency
                              : data.accounts.find((a) => a.id === target)
                                  ?.currency,
                          )}
                          <span className="amount-direction">
                            {t.amount < 0
                              ? 'Money out'
                              : t.amount > 0
                                ? 'Money in'
                                : 'Zero'}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="import-note">
                  Matching date, description, amount, and occurrence within this
                  account are skipped on re-import. Identical repeated
                  transactions within one CSV are kept. Export complete days to
                  avoid ambiguous matches. CSV files aren’t retained.
                </p>
              </>
            )}
            {importError && (
              <div className="message error" role="alert">
                {importError}
              </div>
            )}
          </div>
          <div className="dialog-actions">
            <button
              className="secondary"
              onClick={() => {
                invalidateMappingSuggestion();
                setShowImport(false);
              }}
              disabled={!!busy || bulkLocked}
            >
              Cancel
            </button>
            <button
              className="primary"
              onClick={saveImport}
              disabled={
                !!busy ||
                bulkLocked ||
                mappingBusy ||
                !preview?.transactions.length ||
                !!preview?.errors.length ||
                (target === 'new' &&
                  (!accountDraft.bank.trim() || !accountDraft.name.trim()))
              }
            >
              {busy === 'import' ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Upload size={16} />
              )}{' '}
              {busy === 'import'
                ? 'Saving…'
                : `Save ${preview?.transactions.length || 0} transactions`}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <ExpenseSpreadDialog
        key={spreadTransaction ? `${spreadTransaction.id}-${spreadTransaction.spread_revision}` : 'none'}
        transaction={spreadTransaction}
        currency={currency}
        open={spreadOpen}
        onOpenChange={setSpreadOpen}
        onSaved={async (message) => {
          setNotice(message);
          await refresh();
        }}
        api={api}
      />
    </div>
  );
}
