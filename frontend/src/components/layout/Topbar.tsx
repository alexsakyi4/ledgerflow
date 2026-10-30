import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Menu, Search, Bell, Plus, ChevronDown } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";

type SearchResult = { key: string; label: string; detail: string; to: string };
type SearchResponse<T> = { data: T[] };

export default function Topbar({
  user,
  membership,
  onToggleSidebar,
}: {
  user: { firstName?: string | null; lastName?: string | null; email: string };
  membership: { companyId?: string; companyName: string; role: string } | null;
  onToggleSidebar: () => void;
}) {
  const { companies, selectCompany } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (!membership?.companyId || term.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchOpen(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      const companyId = membership.companyId!;
      const requests = await Promise.allSettled([
        api.get<SearchResponse<{ id: string; displayName: string; email?: string | null }>>(`/companies/${companyId}/contacts`, { params: { search: term } }),
        api.get<SearchResponse<{ id: string; name: string; sku?: string | null }>>(`/companies/${companyId}/products`, { params: { search: term } }),
        api.get<SearchResponse<{ id: string; number: string; contact?: { displayName: string } | null }>>(`/companies/${companyId}/invoices`, { params: { search: term } }),
        api.get<SearchResponse<{ id: string; number: string; contact?: { displayName: string } | null }>>(`/companies/${companyId}/bills`, { params: { search: term } }),
      ]);
      if (!active) return;
      const next: SearchResult[] = [];
      const contacts = requests[0].status === "fulfilled" ? requests[0].value.data.data : [];
      const products = requests[1].status === "fulfilled" ? requests[1].value.data.data : [];
      const invoices = requests[2].status === "fulfilled" ? requests[2].value.data.data : [];
      const bills = requests[3].status === "fulfilled" ? requests[3].value.data.data : [];
      for (const item of contacts.slice(0, 4)) next.push({ key: `contact-${item.id}`, label: item.displayName, detail: item.email || "Customer or vendor", to: "/sales" });
      for (const item of products.slice(0, 4)) next.push({ key: `product-${item.id}`, label: item.name, detail: item.sku ? `Product · ${item.sku}` : "Product or service", to: "/products" });
      for (const item of invoices.slice(0, 4)) next.push({ key: `invoice-${item.id}`, label: item.number, detail: item.contact?.displayName || "Invoice", to: "/sales/invoices" });
      for (const item of bills.slice(0, 4)) next.push({ key: `bill-${item.id}`, label: item.number, detail: item.contact?.displayName || "Bill", to: "/expenses" });
      setResults(next.slice(0, 8));
      setSearching(false);
      setSearchOpen(true);
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, membership?.companyId]);

  function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    if (results[0]) navigate(results[0].to);
    setSearchOpen(false);
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-gray-200 bg-white/90 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3">
        <button onClick={onToggleSidebar} className="p-2 text-gray-600 hover:text-gray-900 lg:hidden" aria-label="Toggle sidebar">
          <Menu className="h-6 w-6" />
        </button>
        <div className="relative hidden w-72 lg:block">
          <form onSubmit={handleSearchSubmit}>
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => query.trim().length >= 2 && setSearchOpen(true)}
              onKeyDown={(event) => { if (event.key === "Escape") setSearchOpen(false); }}
              placeholder="Search customers, invoices, products…"
              aria-label="Search company records"
              aria-expanded={searchOpen}
              className="w-full rounded-md border border-gray-300 py-2 pl-10 pr-4 text-sm outline-none focus:border-qb-green focus:ring-1 focus:ring-qb-green"
            />
          </form>
          {searchOpen && <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-xl">
            {searching ? <p className="px-3 py-3 text-xs text-gray-500">Searching…</p> : results.length ? results.map((result) => <Link key={result.key} to={result.to} onClick={() => { setSearchOpen(false); setQuery(""); }} className="block rounded px-3 py-2 hover:bg-gray-50"><span className="block truncate text-sm font-medium text-gray-800">{result.label}</span><span className="block truncate text-xs text-gray-500">{result.detail}</span></Link>) : <p className="px-3 py-3 text-xs text-gray-500">No matching records.</p>}
          </div>}
        </div>
        <Link to="/sales/invoices" className="flex items-center gap-2 rounded-md px-3 py-2 text-gray-600 transition-colors hover:bg-gray-100" aria-label="Create a new invoice">
          <Plus className="h-4 w-4" />
          <span className="hidden font-medium text-gray-900 sm:inline">New invoice</span>
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex items-center rounded-md border border-gray-200 bg-white">
          {companies.length > 1 ? <>
            <select aria-label="Switch company" value={membership?.companyId || ""} onChange={(event) => void selectCompany(event.target.value)} className="max-w-44 appearance-none bg-transparent py-2 pl-3 pr-8 text-sm font-medium text-gray-700 outline-none">
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 h-4 w-4 text-gray-500" />
          </> : membership ? <span className="px-3 py-2 text-sm font-medium text-gray-700">{membership.companyName}</span> : <Link to="/companies/new" className="px-3 py-2 text-sm font-medium text-qb-green">Set up company</Link>}
        </div>
        <Link to="/companies/new" className="hidden items-center gap-1 rounded-md px-2 py-2 text-xs text-gray-500 hover:bg-gray-100 sm:inline-flex" title="Add another company">
          <Plus className="h-3.5 w-3.5" /> Add company
        </Link>
        <button className="relative cursor-not-allowed p-2 text-gray-400" aria-label="Notifications not configured" title="Notifications are not configured yet" disabled><Bell className="h-5 w-5" /></button>
        <div className="flex items-center gap-2 border-l border-gray-300 pl-2">
          <div className="hidden flex-col items-end sm:flex">
            <p className="text-sm font-medium text-gray-900">{user.firstName || ""} {user.lastName || ""}</p>
            <p className="text-xs text-gray-500">{user.email}</p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-qb-green text-xs font-bold text-white">{(user.firstName || user.email).charAt(0).toUpperCase()}</div>
        </div>
      </div>
    </header>
  );
}
