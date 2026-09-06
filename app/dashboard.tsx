'use client';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  WalletCards,
  Upload,
  ArrowUpRight,
  ShieldCheck,
  Plus,
  FileSpreadsheet,
  Sparkles,
  ArrowDownLeft,
  ArrowUpRight as Outgoing,
  CheckCircle2,
  LoaderCircle,
  ChevronLeft,
  ChevronRight,
  Pencil,
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
  parseMoney,
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
): Promise<T> {
  const r = await fetch(`/api/${path}`, {
    method,
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
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
    [bank, setBank] = useState('Scotiabank'),
    [accountName, setAccountName] = useState(''),
    [accountType, setAccountType] = useState('Chequing'),
    [newCurrency, setNewCurrency] = useState('CAD');
  const [currency, setCurrency] = useState('CAD'),
    [accountFilter, setAccountFilter] = useState('all'),
    [month, setMonth] = useState('all'),
    [categoryFilter, setCategoryFilter] = useState('all'),
    [page, setPage] = useState(0);
  const [editAccount, setEditAccount] = useState<Account | null>(null),
    [balanceInput, setBalanceInput] = useState(''),
    [balanceDate, setBalanceDate] = useState(''),
    [balanceError, setBalanceError] = useState('');
  const [aiConfirm, setAiConfirm] = useState(false);
  const [manageCategories, setManageCategories] = useState(false);
  const pendingReviewOperations = useRef(new Map<string, string>());
  const [mappingBusy, setMappingBusy] = useState(false),
    [mappingNote, setMappingNote] = useState('');
  const mappingRun = useRef(0);
  const categoryLabel = (id: string) =>
    data.categories.find((c) => c.id === id)?.name || id;
  function changeMapping(value: Mapping) {
    mappingRun.current++;
    setMappingBusy(false);
    setMappingNote(
      'Mapping edited manually. Review the preview before saving.',
    );
    setMapping(value);
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
    const selected = data.accounts.find((a) => a.id === target);
    try {
      const result = await api<{
        mapping: Mapping;
        confidence: string;
        note: string;
      }>('map-csv', 'POST', {
        headers: parsed.headers,
        rows: parsed.rows.slice(0, 5).map((r) => r.map((c) => c.slice(0, 500))),
        bank: selected?.bank || bank,
        accountType: selected?.type || accountType,
      });
      if (mappingRun.current !== run) return;
      setMapping(result.mapping);
      setMappingNote(
        `AI suggestion · ${result.confidence} confidence. ${result.note} Review before saving.`,
      );
    } catch (e) {
      if (mappingRun.current === run)
        setMappingNote(
          `${(e as Error).message} Your current mapping is preserved.`,
        );
    } finally {
      if (mappingRun.current === run) setMappingBusy(false);
    }
  }
  const refresh = useCallback(async () => {
    const result = await api<AppData>('data');
    setData(result);
    return result as AppData;
  }, []);
  useEffect(() => {
    refresh()
      .then(async () => {
        const result = await api<{ seeded: number }>('review-memory', 'POST', { limit: 50 });
        if (result.seeded) await refresh();
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refresh]);
  const preview = useMemo(
    () => (csv && mapping ? mapTransactions(csv, mapping) : null),
    [csv, mapping],
  );
  const accounts = data.accounts.filter((a) => a.currency === currency);
  const currencyTransactions = data.transactions.filter((t) =>
    accounts.some((a) => a.id === t.account_id),
  );
  const months = Array.from(
    new Set(currencyTransactions.map((t) => t.date.slice(0, 7))),
  )
    .sort()
    .reverse();
  const scoped = currencyTransactions.filter(
    (t) =>
      (accountFilter === 'all' || t.account_id === accountFilter) &&
      (month === 'all' || t.date.startsWith(month)),
  );
  const visible = scoped.filter(
    (t) =>
      categoryFilter === 'all' ||
      (categoryFilter === 'review'
        ? needsReview(t)
        : t.category === categoryFilter),
  );
  const totals = summary(scoped, data.categories),
    hasBalances = accounts.some((a) => a.balance !== null),
    balance = accounts.reduce((n, a) => n + (a.balance || 0), 0);
  const uncategorized = data.transactions.filter((t) => t.source === 'none'),
    reviewCount = scoped.filter(needsReview).length;
  const spending = data.categories
    .filter((c) => ['expense', 'unclassified'].includes(c.kind))
    .map((definition) => ({
      category: definition.id,
      amount: -scoped
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
  useEffect(() => setPage(0), [currency, accountFilter, month, categoryFilter]);
  async function reviewTransaction(
    transaction: Transaction,
    category: Category,
    action: 'correct' | 'confirm' | 'memory_enable' | 'memory_disable',
    learn: boolean,
  ) {
    setError('');
    setBusy('category');
    const operationKey = `${transaction.id}:${category}:${action}:${learn}:${transaction.category_revision}`;
    const operationId = pendingReviewOperations.current.get(operationKey) || crypto.randomUUID();
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
                confidence: saved.confidence === undefined ? t.confidence : saved.confidence,
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
      if ((e as Error).message.includes('changed')) await refresh().catch(() => undefined);
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
            title: 'Start bank CSV import',
            description:
              'Open the bank CSV import dialog. Does not upload or save any data. The user chooses a file and reviews it before saving.',
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
    const run = ++mappingRun.current;
    setMappingBusy(false);
    setMappingNote('');
    setImportError('');
    setCsv(null);
    setMapping(null);
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setImportError('Choose a .csv export from your bank.');
      return;
    }
    if (file.size > 5_000_000) {
      setImportError('Choose a file smaller than 5 MB.');
      return;
    }
    try {
      const text = await file.text();
      if (mappingRun.current !== run) return;
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
    mappingRun.current++;
    setMappingBusy(false);
    setMappingNote('');
    setImportError('');
    setTarget(account?.id || 'new');
    setCsv(null);
    setMapping(null);
    setRaw('');
    setFilename('');
    setAccountName('');
    if (account) {
      setBank(account.bank);
      setNewCurrency(account.currency);
    }
    setShowImport(true);
  }
  async function saveImport() {
    setBusy('import');
    setImportError('');
    try {
      const r = await api<{ added: number; skipped: number }>(
        'import',
        'POST',
        {
          csv: raw,
          filename,
          mapping,
          accountId: target === 'new' ? null : target,
          account: {
            bank,
            name: accountName,
            type: accountType,
            currency: newCurrency,
          },
        },
      );
      await refresh();
      setNotice(
        `${r.added} transactions imported. ${r.skipped} matching transactions skipped.`,
      );
      setShowImport(false);
      setCurrency(
        target === 'new'
          ? newCurrency
          : data.accounts.find((a) => a.id === target)?.currency || 'CAD',
      );
      setAccountFilter('all');
      setMonth('all');
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
  function startBalance(a: Account) {
    setEditAccount(a);
    setBalanceInput(a.balance === null ? '' : (a.balance / 100).toFixed(2));
    setBalanceDate(a.balance_date || new Date().toISOString().slice(0, 10));
    setBalanceError('');
  }
  async function saveBalance() {
    setBalanceError('');
    const value = parseMoney(balanceInput);
    if (value === null) {
      setBalanceError('Enter a valid balance, such as 1250.00 or -350.00.');
      return;
    }
    setBusy('balance');
    try {
      await api('account', 'PATCH', {
        id: editAccount?.id,
        balance: value,
        balanceDate,
      });
      await refresh();
      setEditAccount(null);
      setNotice('Account balance updated.');
    } catch (e) {
      setBalanceError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">
          <WalletCards size={26} /> account<span>view</span>
        </a>
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
            <p className="eyebrow">SCOTIABANK + WEALTHSIMPLE</p>
            <h1>Your money, together.</h1>
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
          <div className="message success" role="status">
            <CheckCircle2 size={18} />
            {notice}
            <button
              onClick={() => setNotice('')}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        )}
        <div className="overview-toolbar">
          <span className="eyebrow">ACCOUNT OVERVIEW</span>
          <Picker
            label="Currency"
            value={currency}
            onChange={(v) => {
              setCurrency(v);
              setAccountFilter('all');
              setMonth('all');
            }}
            options={opts(['CAD', 'USD'])}
          />
        </div>
        <div className="overview-grid">
          <section className="balance-panel">
            <p>Recorded account balances · {currency}</p>
            <h2>
              {loading ? '…' : hasBalances ? money(balance, currency) : '—'}
            </h2>
            <div className="balance-footer">
              <span>
                {hasBalances
                  ? `${accounts.filter((a) => a.balance !== null).length} of ${accounts.length} accounts have a balance snapshot`
                  : 'Add statement balances to see the full picture'}
              </span>
              <ArrowUpRight size={23} />
            </div>
          </section>
          <section className="metric">
            <p>
              <ArrowDownLeft size={16} /> Income
            </p>
            <h2 className="income">
              {loading ? '…' : money(totals.income, currency)}
            </h2>
            <span className="subtle">
              {month === 'all' ? 'All imported dates' : month} · selected
              accounts
            </span>
          </section>
          <section className="metric">
            <p>
              <Outgoing size={16} /> Net spending
            </p>
            <h2>{loading ? '…' : money(totals.spending, currency)}</h2>
            <span className="subtle">Transfers & investments excluded</span>
          </section>
        </div>
        <section className="section">
          <div className="section-heading">
            <h2>
              Your accounts <span className="count">{accounts.length}</span>
            </h2>
            <button
              className="text-button"
              onClick={() => startImport()}
              disabled={!!busy}
            >
              <Plus size={16} /> Add account
            </button>
          </div>
          <div className="bank-grid">
            {accounts.length
              ? accounts.map((a) => (
                  <article className="account-card" key={a.id}>
                    <div className="account-top">
                      <span
                        className={
                          'bank-icon ' +
                          (a.bank === 'Scotiabank' ? 'scotia' : 'wealth')
                        }
                      >
                        {a.bank === 'Scotiabank' ? 'S' : 'W'}
                      </span>
                      <div>
                        <p className="subtle">{a.bank}</p>
                        <h3>{a.name}</h3>
                      </div>
                      <span className="account-type">{a.type}</span>
                    </div>
                    <div className="account-balance">
                      <strong>
                        {a.balance === null
                          ? 'No balance added'
                          : money(a.balance, a.currency)}
                      </strong>
                      <button
                        className="icon-button"
                        aria-label={`Edit ${a.name} balance`}
                        onClick={() => startBalance(a)}
                      >
                        <Pencil size={15} />
                      </button>
                    </div>
                    <div className="account-bottom">
                      <span>
                        {a.balance_date
                          ? `Snapshot · ${a.balance_date}`
                          : 'Transaction exports may omit balances'}
                      </span>
                      <button
                        className="text-button"
                        onClick={() => startImport(a)}
                        disabled={!!busy}
                      >
                        Import <ArrowRight size={14} />
                      </button>
                    </div>
                  </article>
                ))
              : ['Scotiabank', 'Wealthsimple'].map((b, i) => (
                  <div key={b} className="bank-card">
                    <span className={'bank-icon ' + (i ? 'wealth' : 'scotia')}>
                      {i ? 'W' : 'S'}
                    </span>
                    <div>
                      <h3>{b}</h3>
                      <p className="subtle">
                        {loading
                          ? 'Loading your accounts…'
                          : 'No accounts imported yet'}
                      </p>
                    </div>
                  </div>
                ))}
          </div>
        </section>
        {!loading && !data.transactions.length ? (
          <Empty className="empty-panel">
            <EmptyHeader>
              <Upload size={30} />
              <EmptyTitle className="empty-title">
                Start with a bank export
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
                <div className="filters">
                  <Picker
                    label="Account"
                    value={accountFilter}
                    onChange={setAccountFilter}
                    options={[
                      { value: 'all', label: 'All accounts' },
                      ...accounts.map((a) => ({ value: a.id, label: a.name })),
                    ]}
                  />
                  <Picker
                    label="Period"
                    value={month}
                    onChange={setMonth}
                    options={[
                      { value: 'all', label: 'All imported dates' },
                      ...opts(months),
                    ]}
                  />
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
                      <div
                        className="donut"
                        style={{
                          background: `conic-gradient(${chartSegments})`,
                        }}
                        role="img"
                        aria-label="Spending by category, detailed in the adjacent list"
                      >
                        <div>
                          <span>Net outflow</span>
                          <strong>{money(spendingTotal, currency)}</strong>
                        </div>
                      </div>
                      <div className="legend">
                        {spending.slice(0, 5).map((s, i) => (
                          <button
                            className="legend-row"
                            key={categoryLabel(s.category)}
                            onClick={() => setCategoryFilter(s.category)}
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
                      onClick={() => setCategoryFilter('review')}
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
                <Picker
                  label="Category"
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  options={[
                    { value: 'all', label: 'All categories' },
                    { value: 'review', label: 'Needs review' },
                    ...data.categories.map((c) => ({
                      value: c.id,
                      label: c.name + (c.archived ? ' (archived)' : ''),
                    })),
                  ]}
                />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
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
                        {t.sub_description && (
                          <p className="sub-description">{t.sub_description}</p>
                        )}
                      </TableCell>
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
                                .filter((c) => !c.archived || c.id === t.category)
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
                                      (t.confidence === 'high' ? '' : 'needs-review')
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
                                  <TooltipTrigger className="reviewed-icon" aria-label="Reviewed category">
                                    <CheckCircle2 size={15} />
                                  </TooltipTrigger>
                                  <TooltipContent>Reviewed category</TooltipContent>
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
                              <DropdownMenuContent align="end" className="row-actions-menu">
                                <DropdownMenuItem
                                  onClick={() =>
                                    void reviewTransaction(t, t.category, 'confirm', true)
                                  }
                                >
                                  <CheckCircle2 /> Accept category
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          {t.source === 'ai' && t.categorization_evidence && (() => {
                            let evidence: CategorizationEvidence[] = [];
                            try {
                              evidence = JSON.parse(t.categorization_evidence);
                            } catch {}
                            return evidence.length ? (
                              <details className="ai-evidence">
                                <summary>AI cited your previous reviews</summary>
                                {evidence.map((item) => (
                                  <p key={item.memoryId}>
                                    {item.description}{item.subDescription ? ` · ${item.subDescription}` : ''} → {item.categoryName}
                                    {item.reviewedTransactionCount > 1 ? ` (${item.reviewedTransactionCount} reviews)` : ''}
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
        {data.imports.length > 0 && (
          <section className="section import-history">
            <h2>Recent imports</h2>
            {data.imports.slice(0, 5).map((i) => (
              <div className="history-row" key={i.id}>
                <FileSpreadsheet size={18} />
                <div>
                  <strong>{i.filename}</strong>
                  <p className="subtle">
                    {data.accounts.find((a) => a.id === i.account_id)?.name} ·{' '}
                    {i.created_at.slice(0, 10)}
                  </p>
                </div>
                <span>
                  {i.added} added{' '}
                  <span className="subtle">· {i.skipped} skipped</span>
                </span>
              </div>
            ))}
          </section>
        )}
        <footer className="page-footer">
          <ShieldCheck size={14} />
          <span>
            Private to your signed-in account. Bank connections are manual CSV
            imports.
          </span>
        </footer>
      </main>
      <Dialog
        open={showImport}
        onOpenChange={(v) => {
          if (busy !== 'import') {
            setShowImport(v);
            if (!v) {
              mappingRun.current++;
              setMappingBusy(false);
            }
          }
        }}
      >
        <DialogContent className="import-dialog">
          <DialogHeader>
            <DialogTitle className="dialog-title">
              Import bank transactions
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
              onChange={setTarget}
              options={[
                { value: 'new', label: 'Create a new account' },
                ...data.accounts.map((a) => ({
                  value: a.id,
                  label: `${a.bank} · ${a.name} (${a.currency})`,
                })),
              ]}
            />
            {target === 'new' && (
              <div className="form-grid">
                <Picker
                  label="Bank"
                  value={bank}
                  onChange={setBank}
                  options={opts(['Scotiabank', 'Wealthsimple'])}
                />
                <label className="field">
                  <span>Account nickname</span>
                  <input
                    placeholder="e.g. Everyday chequing"
                    maxLength={80}
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                  />
                </label>
                <Picker
                  label="Account type"
                  value={accountType}
                  onChange={setAccountType}
                  options={opts([
                    'Chequing',
                    'Savings',
                    'Credit card',
                    'Investment',
                  ])}
                />
                <Picker
                  label="Account currency"
                  value={newCurrency}
                  onChange={setNewCurrency}
                  options={opts(['CAD', 'USD'])}
                />
              </div>
            )}
            <label
              className="upload-zone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                loadFile(e.dataTransfer.files[0]);
              }}
            >
              <FileSpreadsheet size={28} />
              <strong>{filename || 'Choose or drop a CSV export'}</strong>
              <span>Scotiabank or Wealthsimple · up to 2,000 rows · 5 MB</span>
              <span>
                AI uses headers and up to five sample rows to suggest a mapping.
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => loadFile(e.target.files?.[0])}
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
                    onClick={() => aiMapping(csv, ++mappingRun.current)}
                  >
                    <Sparkles size={14} />
                    {mappingBusy ? 'Mapping…' : 'Suggest with AI'}
                  </button>
                  <span className="subtle">{csv.rows.length} rows found</span>
                </div>
                {mappingNote && (
                  <p className="mapping-status" role="status">
                    {mappingBusy && <LoaderCircle size={15} className="spin" />}
                    {mappingNote}
                  </p>
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
                              ? newCurrency
                              : data.accounts.find((a) => a.id === target)
                                  ?.currency,
                          )}
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
                mappingRun.current++;
                setMappingBusy(false);
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
                (target === 'new' && !accountName.trim())
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
      <Dialog
        open={!!editAccount}
        onOpenChange={(v) => {
          if (!v && busy !== 'balance') setEditAccount(null);
        }}
      >
        <DialogContent className="balance-dialog">
          <DialogHeader>
            <DialogTitle>Update account balance</DialogTitle>
            <DialogDescription>
              {editAccount?.name} · {editAccount?.currency}. Enter a statement
              or current balance. Use a negative number for credit-card debt.
            </DialogDescription>
          </DialogHeader>
          <label className="field">
            <span>Balance</span>
            <input
              inputMode="decimal"
              value={balanceInput}
              onChange={(e) => setBalanceInput(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label className="field">
            <span>Balance as of</span>
            <input
              type="date"
              value={balanceDate}
              onChange={(e) => setBalanceDate(e.target.value)}
            />
          </label>
          <p className="subtle">
            This snapshot is separate from transaction imports and won’t update
            automatically.
          </p>
          {balanceError && (
            <div className="message error" role="alert">
              {balanceError}
            </div>
          )}
          <button className="primary" disabled={!!busy} onClick={saveBalance}>
            Save balance
          </button>
        </DialogContent>
      </Dialog>
      <CategoryManager
        open={manageCategories}
        onOpenChange={setManageCategories}
        categories={data.categories}
        onSaved={refresh}
      />
      <Dialog open={aiConfirm} onOpenChange={setAiConfirm}>
        <DialogContent className="balance-dialog">
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
