import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, Archive, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import CsvImportPanel from "@/components/import/CsvImportPanel";

const accountTypes = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE", "COGS"] as const;
type AccountType = (typeof accountTypes)[number];
type Account = {
  id: string; companyId: string; parentId: string | null; code: string; name: string; type: AccountType;
  description: string | null; currency: string; openingBalance: string | number; openingBalanceDate: string | null;
  isActive: boolean; isSystem: boolean; parent?: { id: string; code: string; name: string } | null;
  children?: Array<{ id: string; code: string; name: string; isActive: boolean }>;
};
type AccountForm = { code: string; name: string; type: AccountType; description: string; parentId: string; openingBalance: string; openingBalanceDate: string };
const emptyForm: AccountForm = { code: "", name: "", type: "ASSET", description: "", parentId: "", openingBalance: "0", openingBalanceDate: "" };
const typeLabels: Record<AccountType, string> = { ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity", INCOME: "Income", EXPENSE: "Expenses", COGS: "Cost of Goods Sold" };

export default function ChartOfAccounts() {
  const { membership } = useAuth();
  const companyId = membership?.companyId;
  const canEdit = ["OWNER", "ADMIN", "ACCOUNTANT"].includes(membership?.role || "");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("ALL");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<AccountForm>(emptyForm);

  const loadAccounts = useCallback(async () => {
    if (!companyId) { setAccounts([]); setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const response = await api.get<{ data: Account[] }>(`/companies/${companyId}/accounts`, { params: { includeInactive: showInactive } });
      setAccounts(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || "Could not load Chart of Accounts.");
    } finally { setLoading(false); }
  }, [companyId, showInactive]);
  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  const filtered = useMemo(() => accounts.filter((account) => {
    const matchesType = filterType === "ALL" || account.type === filterType;
    const text = `${account.code} ${account.name} ${account.description || ""}`.toLowerCase();
    return matchesType && text.includes(search.toLowerCase());
  }), [accounts, filterType, search]);

  function openCreate() { setEditing(null); setForm(emptyForm); setError(""); setFormOpen(true); }
  function openEdit(account: Account) {
    setEditing(account); setFormOpen(true);
    setForm({ code: account.code, name: account.name, type: account.type, description: account.description || "", parentId: account.parentId || "", openingBalance: String(account.openingBalance), openingBalanceDate: account.openingBalanceDate ? account.openingBalanceDate.slice(0, 10) : "" });
    setError("");
  }
  function closeForm() { setFormOpen(false); setEditing(null); setForm(emptyForm); }

  async function saveAccount(event: FormEvent) {
    event.preventDefault();
    if (!companyId) return;
    setBusy(true); setError("");
    const payload = { ...form, openingBalance: form.openingBalance || "0", parentId: form.parentId || null, openingBalanceDate: form.openingBalanceDate ? new Date(`${form.openingBalanceDate}T00:00:00.000Z`).toISOString() : null };
    try {
      if (editing) await api.patch(`/companies/${companyId}/accounts/${editing.id}`, payload);
      else await api.post(`/companies/${companyId}/accounts`, payload);
      closeForm(); await loadAccounts();
    } catch (err: any) { setError(err.response?.data?.error || "Could not save account."); }
    finally { setBusy(false); }
  }

  async function archive(account: Account) {
    if (!companyId || !window.confirm(`Archive ${account.code} — ${account.name}?`)) return;
    setError("");
    try { await api.delete(`/companies/${companyId}/accounts/${account.id}`); await loadAccounts(); }
    catch (err: any) { setError(err.response?.data?.error || "Could not archive account."); }
  }

  const currency = membership?.companyCurrency || "GHS";
  const formatBalance = (value: string | number) => new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2 }).format(Number(value));

  if (!companyId) return <div className="card"><h1 className="text-xl font-bold">Chart of Accounts</h1><p className="mt-2 text-sm text-gray-600">Create or select a company before managing its accounts.</p></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><h1 className="text-2xl font-bold text-gray-900">Chart of Accounts</h1><p className="text-sm text-gray-600">Organize the accounts used to classify your business transactions.</p></div>
        {canEdit && <button onClick={openCreate} className="btn-primary"><Plus className="mr-2 h-4 w-4" />New account</button>}
      </div>
      <div className="card border border-emerald-100 bg-emerald-50/60">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">QuickBooks equivalent</p>
        <p className="mt-1 text-sm text-emerald-900">Accounting → Chart of Accounts. Add, edit, organize sub-accounts, set opening balances, and make unused accounts inactive.</p>
      </div>
      {canEdit && <CsvImportPanel entity="CHART_OF_ACCOUNTS" onImported={() => void loadAccounts()} />}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, number, or description" className="input pl-9" /></div>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="input sm:w-56"><option value="ALL">All account types</option>{accountTypes.map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}</select>
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-emerald-600" /> Show inactive</label>
      </div>
      {error && !editing && <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}
      {editing !== null && <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}
      <div className="card !p-0 overflow-hidden">
        {loading ? <div className="p-10 text-center text-sm text-gray-500">Loading accounts…</div> : filtered.length === 0 ? <div className="p-10 text-center text-sm text-gray-500">No accounts match your filters.</div> : (
          <div className="table-wrap"><table><thead><tr><th>Number</th><th>Name</th><th>Type</th><th>Detail / parent</th><th className="text-right">Opening balance</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
            <tbody>{filtered.map((account) => <tr key={account.id} className={!account.isActive ? "bg-gray-50 text-gray-400" : ""}>
              <td className="font-mono text-xs">{account.code}</td><td><span className={account.parentId ? "pl-5" : "font-medium"}>{account.parentId ? "↳ " : ""}{account.name}</span>{account.isSystem && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">DEFAULT</span>}</td>
              <td>{typeLabels[account.type]}</td><td className="text-gray-500">{account.parent ? `${account.parent.code} — ${account.parent.name}` : account.description || "—"}</td><td className="text-right tabular-nums">{formatBalance(account.openingBalance)}{account.openingBalanceDate && <span className="ml-1 text-xs text-gray-400">as of {new Date(account.openingBalanceDate).toLocaleDateString()}</span>}</td>
              <td><span className={`rounded-full px-2 py-1 text-xs ${account.isActive ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{account.isActive ? "Active" : "Inactive"}</span></td>
              {canEdit && <td><div className="flex items-center gap-1"><button onClick={() => openEdit(account)} aria-label={`Edit ${account.name}`} className="rounded p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"><Pencil className="h-4 w-4" /></button>{account.isActive && <button disabled={account.isSystem} onClick={() => void archive(account)} aria-label={`Archive ${account.name}`} title={account.isSystem ? "System accounts cannot be archived" : "Archive account"} className="rounded p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"><Archive className="h-4 w-4" /></button>}</div></td>}
            </tr>)}</tbody>
          </table></div>
        )}
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={editing ? "Edit account" : "New account"}>
          <form onSubmit={saveAccount} className="max-h-[90vh] w-full max-w-2xl space-y-5 overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">{editing ? "Edit account" : "New account"}</h2><p className="text-xs text-gray-500">Account details and opening balance</p></div><button type="button" onClick={closeForm} className="rounded p-2 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="label">Account number *<input required maxLength={32} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="input mt-1" /></label>
              <label className="label">Account name *<input required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input mt-1" /></label>
              <label className="label">Account type<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })} className="input mt-1">{accountTypes.map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}</select></label>
              <label className="label">Sub-account of<select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })} className="input mt-1"><option value="">No parent account</option>{accounts.filter((account) => account.isActive && account.id !== editing?.id).map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select></label>
              <label className="label">Opening balance<input type="number" step="0.0001" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} className="input mt-1" /></label>
              <label className="label">Opening balance date<input type="date" value={form.openingBalanceDate} onChange={(e) => setForm({ ...form, openingBalanceDate: e.target.value })} className="input mt-1" /></label>
              <label className="label sm:col-span-2">Description<textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input mt-1" /></label>
            </div>
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <div className="flex justify-end gap-3 border-t pt-4"><button type="button" onClick={closeForm} className="btn-outline">Cancel</button><button disabled={busy} className="btn-primary">{busy ? "Saving…" : "Save account"}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
