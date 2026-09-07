'use client';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  WalletCards,
  Upload,
  ShieldCheck,
  FileSpreadsheet,
  Sparkles,
  ArrowDownLeft,
  ArrowUpRight as Outgoing,
  CheckCircle2,
  LoaderCircle,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  LockKeyhole,
  MoreHorizontal,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import CategoryManager from './category-manager';
import AccountManager, {
  AccountFields,
  EMPTY_ACCOUNT,
  type AccountDraft,
} from './account-manager';
import ImportHistory from './import-history';
import ImportResults from './import-results';
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
  summary,
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
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterErrors,
  type TransactionFilters,
} from '@/lib/transaction-filters';
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
  const r = await fetch(`/api/${path}`, {
    method,
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal,
  });
  let result;
  try {
    result = await r.json();
  } catch {
    throw new Error('Could not reach your workspace. Please reload.');
  }
  if (!r.ok)
    throw new Error(
      (result as { error?: string }).error ||
        'Something went wrong. Please try again.',
    );
  return result as T;
}
function Picker({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)}>
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
function TransactionFilterControls({ filters, errors, data, accounts, update }: {
  filters: TransactionFilters;
  errors: FilterErrors;
  data: AppData;
  accounts: Account[];
  update: (change: Partial<TransactionFilters>, message?: string) => void;
}) {
  const currency = filters.currency;
  return (
    <div className="transaction-filters" aria-label="Transaction filters">
      <label className="field filter-search" htmlFor="transaction-search"><span>Search</span><input id="transaction-search" value={filters.q} placeholder="Description or sub-description" onChange={(event) => update({ q: event.target.value })} /></label>
      <Picker label="Currency" value={currency} onChange={(nextCurrency) => update({ currency: nextCurrency }, filters.importGroup ? 'The import group was cleared because the currency changed.' : '')} options={opts(['CAD', 'USD'])} />
      <Picker label="Direction" value={filters.direction} onChange={(direction) => update({ direction: direction as TransactionFilters['direction'] })} options={[{ value: 'all', label: 'All directions' }, { value: 'debit', label: 'Money out' }, { value: 'credit', label: 'Money in' }]} />
      <label className="field" htmlFor="minimum-amount"><span>Minimum amount</span><input id="minimum-amount" inputMode="decimal" value={filters.minAmount} onChange={(event) => update({ minAmount: event.target.value })} aria-invalid={!!errors.minAmount} />{errors.minAmount && <small className="filter-error">{errors.minAmount}</small>}</label>
      <label className="field" htmlFor="maximum-amount"><span>Maximum amount</span><input id="maximum-amount" inputMode="decimal" value={filters.maxAmount} onChange={(event) => update({ maxAmount: event.target.value })} aria-invalid={!!errors.maxAmount} />{errors.maxAmount && <small className="filter-error">{errors.maxAmount}</small>}</label>
      <Picker label="Category" value={filters.category} onChange={(category) => update({ category })} options={[{ value: 'all', label: 'All categories' }, { value: 'review', label: 'Needs review' }, ...data.categories.map((category) => ({ value: category.id, label: category.name + (category.archived ? ' (archived)' : '') }))]} />
      <Picker label="Account" value={filters.account} onChange={(account) => update({ account }, filters.importGroup && account !== filters.account ? 'The import group was cleared because the account changed.' : '')} options={[{ value: 'all', label: 'All accounts' }, ...accounts.map((account) => ({ value: account.id, label: `${account.name}${account.archived ? ' (archived)' : ''}` }))]} />
      <label className="field" htmlFor="date-from"><span>From</span><input id="date-from" type="date" value={filters.from} onChange={(event) => update({ from: event.target.value })} aria-invalid={!!errors.date} /></label>
      <label className="field" htmlFor="date-to"><span>To</span><input id="date-to" type="date" value={filters.to} onChange={(event) => update({ to: event.target.value })} aria-invalid={!!errors.date} />{errors.date && <small className="filter-error">{errors.date}</small>}</label>
      <Picker label="Import group" value={filters.importGroup} onChange={(importGroup) => {
        const record = data.imports.find((item) => item.id === importGroup);
        const account = record && data.accounts.find((item) => item.id === record.account_id);
        update(record ? { importGroup, account: record.account_id, currency: account?.currency || currency } : { importGroup: '' });
      }} options={[{ value: '', label: 'All imports' }, ...data.imports.map((item) => {
        const account = data.accounts.find((candidate) => candidate.id === item.account_id);
        return { value: item.id, label: `${item.filename} · ${account?.name || 'Account'} · ${new Date(item.created_at).toLocaleString()}` };
      })]} />
    </div>
  );
}
export default function Dashboard() {
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
  const [filters, setFilters] = useState<TransactionFilters>(DEFAULT_TRANSACTION_FILTERS),
    [page, setPage] = useState(0),
    [locationRevision, setLocationRevision] = useState(0);
  const [aiConfirm, setAiConfirm] = useState(false);
  const [manageCategories, setManageCategories] = useState(false);
  const pendingReviewOperations = useRef(new Map<string, string>());
  const pendingImportOperation = useRef<{ key: string; id: string } | null>(null);
  const [currentImportId, setCurrentImportId] = useState<string | null>(null);
  const [mappingBusy, setMappingBusy] = useState(false),
    [mappingNote, setMappingNote] = useState('');
  const mappingGate = useRef(new MappingSuggestionGate());
  const mappingAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    const readLocation = () => {
      const params = new URLSearchParams(window.location.search);
      setCurrentImportId(params.get('view') === 'import' ? params.get('importId') : null);
      setLocationRevision((revision) => revision + 1);
    };
    readLocation();
    window.addEventListener('popstate', readLocation);
    return () => window.removeEventListener('popstate', readLocation);
  }, []);
  const currency = filters.currency;
  const updateFilters = useCallback((change: Partial<TransactionFilters>, message = '') => {
    setFilters((current) => {
      const next = { ...current, ...change };
      if (change.currency && change.currency !== current.currency && change.importGroup === undefined) {
        next.account = 'all';
        next.importGroup = '';
      }
      if (change.account !== undefined && change.account !== current.account && current.importGroup && change.importGroup === undefined) {
        const group = data.imports.find((item) => item.id === current.importGroup);
        if (group && change.account !== group.account_id) next.importGroup = '';
      }
      const params = filtersToSearchParams(next, new URLSearchParams(window.location.search));
      window.history.replaceState({}, '', `/?${params.toString()}`);
      return next;
    });
    setPage(0);
    if (message) setNotice(message);
  }, [data.imports]);
  const categoryLabel = (id: string) =>
    data.categories.find((c) => c.id === id)?.name || id;
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
      const page = await api<{ items: AppData['imports']; nextCursor: string | null }>(`imports?${params}`);
      imports.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    const complete = { ...result, imports };
    setData(complete);
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
      if (params.get('view') === 'import' && params.get('importId') && !params.get('importGroup'))
        params.set('importGroup', params.get('importId')!);
      const parsed = filtersFromSearchParams(params, data.accounts, data.imports, data.categories.map((category) => category.id));
      setFilters(parsed.filters);
      setPage(0);
      if (parsed.notice) setNotice(parsed.notice);
      const normalized = filtersToSearchParams(parsed.filters, params);
      if (normalized.toString() !== new URLSearchParams(window.location.search).toString())
        window.history.replaceState({}, '', `/?${normalized.toString()}`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data.accounts, data.categories, data.imports, loading, locationRevision]);
  const preview = useMemo(
    () => (csv && mapping ? mapTransactions(csv, mapping) : null),
    [csv, mapping],
  );
  const accounts = data.accounts.filter((a) => a.currency === currency);
  const { filteredTransactions, filteredIds, filterValid, errors: filterErrors } = useMemo(
    () => filterTransactions(data.transactions, data.accounts, filters),
    [data.accounts, data.transactions, filters],
  );
  const visible = filteredTransactions;
  void filteredIds;
  const totals = summary(filteredTransactions, data.categories);
  const uncategorized = data.transactions.filter((t) => t.source === 'none'),
    reviewCount = filteredTransactions.filter(needsReview).length;
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
  async function reviewTransaction(
    transaction: Transaction,
    category: Category,
    action: 'correct' | 'confirm' | 'memory_enable' | 'memory_disable',
    learn: boolean,
  ) {
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
      setData((d) => ({
        ...d,
        transactions: d.transactions.map((t) =>
          t.id === transaction.id
            ? {
                ...t,
                category: saved.category,
                source: saved.source ?? t.source,
                confidence:
                  saved.confidence === undefined
                    ? t.confidence
                    : saved.confidence,
                category_revision: saved.categoryRevision,
                reviewed_at: saved.reviewedAt,
                memory_enabled: saved.memoryEnabled ? 1 : 0,
                categorization_evidence:
                  action === 'correct' || action === 'confirm'
                    ? null
                    : t.categorization_evidence,
              }
            : t,
        ),
      }));
      setNotice('Category accepted and available for future categorization.');
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
    if (busy) return;
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
      const r = await api<{ importId: string; accountId: string; currency: string; added: number; skipped: number; enriched: number }>(
        'import',
        'POST',
        { ...requestPayload, operationId },
      );
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
      const params = filtersToSearchParams(importedFilters, new URLSearchParams({ view: 'import', importId: r.importId }));
      const nextUrl = `/?${params.toString()}`;
      window.history.pushState({}, '', nextUrl);
      setCurrentImportId(r.importId);
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function categorize() {
    setAiConfirm(false);
    setBusy('ai');
    setError('');
    let completed = 0;
    try {
      for (let i = 0; i < uncategorized.length; i += 60) {
        const result = await api<{ categorized: number }>(
          'categorize',
          'POST',
          { ids: uncategorized.slice(i, i + 60).map((t) => t.id) },
        );
        completed += result.categorized;
        setNotice(
          `AI categorized ${completed} of ${uncategorized.length} transactions…`,
        );
        await refresh();
      }
      setNotice(
        `AI categorized ${completed} transactions. Review suggestions and adjust any category.`,
      );
    } catch (e) {
      setError((e as Error).message);
      setNotice(
        completed
          ? `${completed} transactions categorized. Your other transactions are saved.`
          : '',
      );
    } finally {
      setBusy('');
    }
  }
  if (currentImportId)
    return (
      <div className="app-shell">
        <header className="topbar">
          <Link className="brand" href="/?view=transactions"><WalletCards size={26} /> account<span>view</span></Link>
          <div className="top-right"><span className="privacy"><ShieldCheck size={16} /> Private workspace</span>{/* oxlint-disable-next-line next/no-html-link-for-pages -- auth requires a top-level navigation */}<a className="signout" href="/signout-with-chatgpt?return_to=%2F" target="_top">Sign out</a></div>
        </header>
        <ImportResults importId={currentImportId}>
          <section className="section transaction-panel import-transaction-panel">
            <div className="transaction-heading">
              <div><h2>New transactions <span className="count">{visible.length}</span></h2><p className="subtle">Transactions added by this import and still available.</p></div>
              <div className="results-table-actions"><button className="secondary" disabled={JSON.stringify(filters) === JSON.stringify({ ...DEFAULT_TRANSACTION_FILTERS, currency })} onClick={() => updateFilters({ ...DEFAULT_TRANSACTION_FILTERS, currency })}>Clear filters</button><Link className="secondary-link" href={`/?${filtersToSearchParams(filters, new URLSearchParams({ view: 'transactions' })).toString()}`}>Open full transaction view</Link></div>
            </div>
            <TransactionFilterControls filters={filters} errors={filterErrors} data={data} accounts={accounts} update={updateFilters} />
            {!filterValid && <div className="message error" role="alert">Correct the filter values to show transactions.</div>}
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Sub-description</TableHead><TableHead>Account</TableHead><TableHead>Category</TableHead><TableHead className="right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>{visible.slice(page * 25, page * 25 + 25).map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell className="date-cell">{transaction.date}</TableCell>
                  <TableCell className="description-cell">{transaction.description}</TableCell>
                  <TableCell className="sub-description-cell">{transaction.sub_description || <span className="subtle">—</span>}</TableCell>
                  <TableCell><span className="subtle">{data.accounts.find((account) => account.id === transaction.account_id)?.name}</span></TableCell>
                  <TableCell>{categoryLabel(transaction.category)}</TableCell>
                  <TableCell className={'right amount ' + (transaction.amount > 0 ? 'income' : '')}>{transaction.amount > 0 ? '+' : ''}{money(transaction.amount, currency)}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
            {!visible.length && <div className="small-empty">No new transactions remain from this import. Matching rows are still shown above.</div>}
            <div className="table-footer"><span>{visible.length ? `${page * 25 + 1}–${Math.min(page * 25 + 25, visible.length)} of ${visible.length}` : '0 transactions'}</span><div><button className="icon-button" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={18} /></button><button className="icon-button" aria-label="Next page" disabled={(page + 1) * 25 >= visible.length} onClick={() => setPage((value) => value + 1)}><ChevronRight size={18} /></button></div></div>
          </section>
        </ImportResults>
      </div>
    );
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <WalletCards size={26} /> account<span>view</span>
        </Link>
        <div className="top-right">
          <button
            className="text-button"
            disabled={loading || !!busy}
            onClick={() => setManageCategories(true)}
          >
            Categories
          </button>
          <span className="privacy">
            <ShieldCheck size={16} /> Private workspace
          </span>
          {/* oxlint-disable-next-line next/no-html-link-for-pages -- auth requires a top-level navigation */}
          <a
            className="signout"
            href="/signout-with-chatgpt?return_to=%2F"
            target="_top"
          >
            Sign out
          </a>
        </div>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <p className="eyebrow">YOUR TRANSACTION WORKSPACE</p>
            <h1>Every account, one clear view.</h1>
            <p className="subtle">
              An account overview, with every transaction in its place.
            </p>
          </div>
          <button
            className="primary"
            onClick={() => startImport()}
            disabled={loading || !!busy}
          >
            <Upload size={17} /> Import CSV
          </button>
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
        <div className="overview-toolbar">
          <span className="eyebrow">ACCOUNT OVERVIEW</span>
          <Picker
            label="Currency"
            value={currency}
            onChange={(v) => {
              updateFilters(
                { currency: v },
                filters.importGroup ? 'The import group was cleared because the currency changed.' : '',
              );
            }}
            options={opts(['CAD', 'USD'])}
          />
        </div>
        <div className="overview-grid flow-overview">
          <section className="metric">
            <p>
              <ArrowDownLeft size={16} /> Transaction income
            </p>
            <h2 className="income">
              {loading ? '…' : money(totals.income, currency)}
            </h2>
            <span className="subtle">
              {visible.length} matching transactions · transaction flow
            </span>
          </section>
          <section className="metric">
            <p>
              <Outgoing size={16} /> Transaction spending
            </p>
            <h2>{loading ? '…' : money(totals.spending, currency)}</h2>
            <span className="subtle">
              Transaction flow · transfers & investments excluded
            </span>
          </section>
        </div>
        <AccountManager
          accounts={data.accounts}
          transactionAccountIds={
            new Set([
              ...data.transactions.map((transaction) => transaction.account_id),
              ...data.imports.map((record) => record.account_id),
            ])
          }
          busy={loading || !!busy}
          request={(method, payload) => api('account', method, payload)}
          onChanged={refresh}
          onImport={startImport}
          onNotice={setNotice}
          onError={setError}
        />
        {!loading && !data.transactions.length ? (
          <Empty className="empty-panel">
            <EmptyHeader>
              <Upload size={30} />
              <EmptyTitle className="empty-title">
                Start with a transaction export
              </EmptyTitle>
              <EmptyDescription>
                Upload a CSV to bring your accounts and transactions into view.
                You’ll review the columns and amounts before saving.
              </EmptyDescription>
            </EmptyHeader>
            <button className="primary" onClick={() => startImport()}>
              <Upload size={16} /> Import your first CSV
            </button>
            <p className="privacy">
              <LockKeyhole size={14} /> Saved in your private cloud workspace
            </p>
          </Empty>
        ) : (
          <>
            <section className="section">
              <div className="analysis-header">
                <div>
                  <h2>Transaction breakdown</h2>
                  <p className="subtle">
                    Totals follow your categories. Review transfers and refunds
                    for accuracy.
                  </p>
                </div>
              </div>
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
                        {spending.slice(0, 5).map((s, i) => (
                          <button
                            className="legend-row"
                            key={categoryLabel(s.category)}
                            onClick={() => updateFilters({ category: s.category })}
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
                        {spending.length > 5 && (
                          <span className="subtle">
                            + {spending.length - 5} more categories in the
                            transactions below
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="small-empty">
                      No spending in this selection.
                    </div>
                  )}
                </section>
                <section className="ai-panel">
                  <div className="ai-icon">
                    <Sparkles size={23} />
                  </div>
                  <h3>A little clarity, powered by AI.</h3>
                  <p>
                    Get suggested categories for your transactions, then make
                    them your own.
                  </p>
                  <button
                    className="primary"
                    disabled={!!busy || !data.aiReady || !uncategorized.length}
                    onClick={() => setAiConfirm(true)}
                  >
                    {busy === 'ai' ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Sparkles size={16} />
                    )}{' '}
                    {busy === 'ai'
                      ? 'Categorizing…'
                      : `Categorize ${uncategorized.length} transactions`}
                  </button>
                  <span className="subtle">
                    {data.aiReady
                      ? 'Your manual categories are always kept.'
                      : 'AI connection pending. Manual categories are available below.'}
                  </span>
                  {reviewCount > 0 && (
                    <button
                      className="review-link"
                      onClick={() => updateFilters({ category: 'review' })}
                    >
                      {reviewCount} transactions to review{' '}
                      <ArrowRight size={15} />
                    </button>
                  )}
                </section>
              </div>
            </section>
            <section className="section transaction-panel">
              <div className="transaction-heading">
                <div>
                  <h2>
                    Transactions <span className="count">{visible.length}</span>
                  </h2>
                  <p className="subtle">Change any category to correct it.</p>
                </div>
                <button
                  className="secondary"
                  disabled={JSON.stringify(filters) === JSON.stringify({ ...DEFAULT_TRANSACTION_FILTERS, currency })}
                  onClick={() => updateFilters({ ...DEFAULT_TRANSACTION_FILTERS, currency })}
                >
                  Clear filters
                </button>
              </div>
              <TransactionFilterControls filters={filters} errors={filterErrors} data={data} accounts={accounts} update={updateFilters} />
              {!filterValid && <div className="message error" role="alert">Correct the filter values to show transactions.</div>}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Sub-description</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.slice(page * 25, page * 25 + 25).map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="date-cell">{t.date}</TableCell>
                      <TableCell className="description-cell">
                        {t.description}
                      </TableCell>
                      <TableCell className="sub-description-cell">{t.sub_description || <span className="subtle">—</span>}</TableCell>
                      <TableCell>
                        <span className="subtle">
                          {
                            data.accounts.find((a) => a.id === t.account_id)
                              ?.name
                          }
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="category-cell">
                          <div className="category-row">
                            <NativeSelect
                              value={t.category}
                              aria-label={`Category for ${t.description} on ${t.date}`}
                              disabled={!!busy}
                              onChange={(e) => {
                                const next = e.target.value as Category;
                                void reviewTransaction(
                                  t,
                                  next,
                                  next === t.category ? 'confirm' : 'correct',
                                  true,
                                );
                              }}
                            >
                              {data.categories
                                .filter(
                                  (c) => !c.archived || c.id === t.category,
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
                                disabled={!!busy}
                              >
                                <MoreHorizontal size={17} />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className="row-actions-menu"
                              >
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
                    ? `${page * 25 + 1}–${Math.min(page * 25 + 25, visible.length)} of ${visible.length}`
                    : '0 transactions'}
                </span>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Previous page"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Next page"
                    disabled={(page + 1) * 25 >= visible.length}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            </section>
          </>
        )}
        <ImportHistory initial={data.imports} />
        <footer className="page-footer">
          <ShieldCheck size={14} />
          <span>
            Private to your signed-in account. Transactions are added with
            manual CSV imports.
          </span>
        </footer>
      </main>
      <Dialog
        open={showImport}
        onOpenChange={(v) => {
          if (busy !== 'import') {
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
                disabled={!!busy}
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
              disabled={!!busy}
            >
              Cancel
            </button>
            <button
              className="primary"
              onClick={saveImport}
              disabled={
                !!busy ||
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
      <CategoryManager
        open={manageCategories}
        onOpenChange={setManageCategories}
        categories={data.categories}
        onSaved={refresh}
      />
      <Dialog open={aiConfirm} onOpenChange={setAiConfirm}>
        <DialogContent className="confirm-dialog">
          <DialogHeader>
            <DialogTitle>Suggest transaction categories</DialogTitle>
            <DialogDescription>
              Send descriptions, sub-descriptions, amounts, currency, and
              account type for {uncategorized.length} uncategorized transactions
              to OpenAI. Account owner details, account nicknames, and full CSV
              files are excluded.
            </DialogDescription>
          </DialogHeader>
          <p className="subtle">
            AI suggestions can be wrong. Review transfers and uncertain
            categories. Your manual edits won’t be overwritten.
          </p>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setAiConfirm(false)}>
              Cancel
            </button>
            <button className="primary" onClick={categorize}>
              <Sparkles size={16} /> Categorize
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
