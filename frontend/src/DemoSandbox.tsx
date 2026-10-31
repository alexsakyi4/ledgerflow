import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, BarChart3, BookOpen,
  Boxes, Building2, Check, ChevronDown, HelpCircle, FileText, LayoutDashboard,
  Menu, Plus, RotateCcw, Search, ShoppingCart, Trash2, Users, Wallet, X,
} from "lucide-react";

type ContactKind = "Customer" | "Vendor" | "Both";
type Status = "Draft" | "Due" | "Paid";
type Contact = { id: string; name: string; kind: ContactKind; email: string; phone: string };
type Product = { id: string; name: string; sku: string; kind: "Product" | "Service"; price: number; cost: number; stock: number };
type Invoice = { id: string; number: string; contactId: string; date: string; dueDate: string; description: string; amount: number; status: Status };
type Bill = { id: string; number: string; contactId: string; date: string; dueDate: string; description: string; amount: number; status: Status };
type DemoData = { contacts: Contact[]; products: Product[]; invoices: Invoice[]; bills: Bill[]; openingCash: number };
type Page = "Overview" | "Sales" | "Purchases" | "Contacts" | "Products" | "Banking" | "Reports" | "Accounts";
type FormKind = "invoice" | "bill" | "contact" | "product" | null;

const STORAGE_KEY = "ledgerflow.learning-sandbox.v1";
const today = new Date().toISOString().slice(0, 10);
const day = (delta: number) => new Date(Date.now() + delta * 86400000).toISOString().slice(0, 10);
const id = () => globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function sampleData(): DemoData {
  const contacts: Contact[] = [
    { id: "c1", name: "Ama’s Kitchen", kind: "Customer", email: "ama@example.test", phone: "+233 20 555 0101" },
    { id: "c2", name: "Accra Creative Hub", kind: "Customer", email: "accounts@creative.example.test", phone: "+233 24 555 0112" },
    { id: "c3", name: "Kojo Ventures", kind: "Customer", email: "kojo@example.test", phone: "+233 50 555 0188" },
    { id: "c4", name: "Coastal Office Supply", kind: "Vendor", email: "billing@coastal.example.test", phone: "+233 30 555 0140" },
    { id: "c5", name: "Brightline Utilities", kind: "Vendor", email: "hello@brightline.example.test", phone: "+233 27 555 0162" },
  ];
  return {
    contacts,
    products: [
      { id: "p1", name: "Brand identity package", sku: "SRV-001", kind: "Service", price: 2400, cost: 850, stock: 0 },
      { id: "p2", name: "Website design", sku: "SRV-002", kind: "Service", price: 3600, cost: 1400, stock: 0 },
      { id: "p3", name: "Printed welcome kit", sku: "KIT-010", kind: "Product", price: 180, cost: 92, stock: 36 },
    ],
    invoices: [
      { id: "i1", number: "INV-1042", contactId: "c1", date: day(-18), dueDate: day(-4), description: "Brand identity package", amount: 2400, status: "Paid" },
      { id: "i2", number: "INV-1043", contactId: "c2", date: day(-8), dueDate: day(6), description: "Website design · milestone 1", amount: 3600, status: "Due" },
      { id: "i3", number: "INV-1044", contactId: "c3", date: today, dueDate: day(14), description: "Printed welcome kits", amount: 1260, status: "Draft" },
    ],
    bills: [
      { id: "b1", number: "BILL-071", contactId: "c4", date: day(-10), dueDate: day(4), description: "Packaging and stationery", amount: 540, status: "Due" },
      { id: "b2", number: "BILL-072", contactId: "c5", date: day(-22), dueDate: day(-8), description: "Electricity · monthly", amount: 320, status: "Paid" },
    ],
    openingCash: 8200,
  };
}

function readData(): DemoData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const value = JSON.parse(raw) as DemoData;
      if (Array.isArray(value.contacts) && Array.isArray(value.products) && Array.isArray(value.invoices) && Array.isArray(value.bills)) return value;
    }
  } catch { /* Start with sample data if browser storage is unavailable or malformed. */ }
  return sampleData();
}

const money = (amount: number) => new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", maximumFractionDigits: 2 }).format(amount);
const prettyDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("en-GH", { day: "2-digit", month: "short", year: "numeric" });

const nav: Array<{ page: Page; icon: typeof LayoutDashboard; group: string }> = [
  { page: "Overview", icon: LayoutDashboard, group: "Workspace" },
  { page: "Sales", icon: ArrowUpRight, group: "Workspace" },
  { page: "Purchases", icon: ArrowDownLeft, group: "Workspace" },
  { page: "Contacts", icon: Users, group: "Manage" },
  { page: "Products", icon: Boxes, group: "Manage" },
  { page: "Banking", icon: Wallet, group: "Manage" },
  { page: "Reports", icon: BarChart3, group: "Insights" },
  { page: "Accounts", icon: BookOpen, group: "Insights" },
];

export default function DemoSandbox() {
  const [data, setData] = useState<DemoData>(readData);
  const [page, setPage] = useState<Page>("Overview");
  const [formKind, setFormKind] = useState<FormKind>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* The demo remains usable for this page load. */ }
  }, [data]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const contactName = (contactId: string) => data.contacts.find((contact) => contact.id === contactId)?.name || "Unknown contact";
  const receivable = data.invoices.filter((item) => item.status === "Due").reduce((sum, item) => sum + item.amount, 0);
  const payable = data.bills.filter((item) => item.status === "Due").reduce((sum, item) => sum + item.amount, 0);
  const income = data.invoices.filter((item) => item.status !== "Draft").reduce((sum, item) => sum + item.amount, 0);
  const expenses = data.bills.filter((item) => item.status !== "Draft").reduce((sum, item) => sum + item.amount, 0);
  const cash = data.openingCash + data.invoices.filter((item) => item.status === "Paid").reduce((sum, item) => sum + item.amount, 0) - data.bills.filter((item) => item.status === "Paid").reduce((sum, item) => sum + item.amount, 0);
  const profit = income - expenses;
  const filteredContacts = useMemo(() => data.contacts.filter((item) => `${item.name} ${item.email} ${item.kind}`.toLowerCase().includes(search.toLowerCase())), [data.contacts, search]);
  const filteredProducts = useMemo(() => data.products.filter((item) => `${item.name} ${item.sku}`.toLowerCase().includes(search.toLowerCase())), [data.products, search]);

  function openForm(kind: Exclude<FormKind, null>) {
    setSearch("");
    setFormKind(kind);
    setForm(kind === "invoice" || kind === "bill"
      ? { contactId: "", date: today, dueDate: day(14), description: "", amount: "" }
      : kind === "contact"
        ? { name: "", kind: "Customer", email: "", phone: "" }
        : { name: "", sku: "", kind: "Service", price: "", cost: "", stock: "0" });
  }

  function saveForm(event: FormEvent) {
    event.preventDefault();
    if (!formKind) return;
    if (formKind === "invoice" || formKind === "bill") {
      const amount = Number(form.amount);
      if (!form.contactId || !Number.isFinite(amount) || amount <= 0) { setToast("Choose a contact and enter an amount greater than zero."); return; }
      if (formKind === "invoice") {
        const count = data.invoices.length + 1042;
        setData((current) => ({ ...current, invoices: [{ id: id(), number: `INV-${count}`, contactId: form.contactId, date: form.date || today, dueDate: form.dueDate || day(14), description: form.description || "Sales invoice", amount, status: "Due" }, ...current.invoices] }));
      } else {
        const count = data.bills.length + 71;
        setData((current) => ({ ...current, bills: [{ id: id(), number: `BILL-${count}`, contactId: form.contactId, date: form.date || today, dueDate: form.dueDate || day(14), description: form.description || "Supplier bill", amount, status: "Due" }, ...current.bills] }));
      }
    } else if (formKind === "contact") {
      if (!form.name.trim()) { setToast("Enter a contact name."); return; }
      setData((current) => ({ ...current, contacts: [{ id: id(), name: form.name.trim(), kind: form.kind as ContactKind, email: form.email.trim(), phone: form.phone.trim() }, ...current.contacts] }));
    } else {
      const price = Number(form.price || 0);
      setData((current) => ({ ...current, products: [{ id: id(), name: form.name.trim() || "New item", sku: form.sku.trim(), kind: form.kind as Product["kind"], price, cost: Number(form.cost || 0), stock: Number(form.stock || 0) }, ...current.products] }));
    }
    setFormKind(null);
    setToast(`${formKind === "invoice" ? "Invoice" : formKind === "bill" ? "Bill" : formKind === "contact" ? "Contact" : "Item"} saved in this browser.`);
  }

  function updateInvoice(invoiceId: string, status: Status) {
    setData((current) => ({ ...current, invoices: current.invoices.map((item) => item.id === invoiceId ? { ...item, status } : item) }));
    setToast(status === "Paid" ? "Invoice marked paid; cash balance updated." : `Invoice marked ${status.toLowerCase()}.`);
  }
  function updateBill(billId: string, status: Status) {
    setData((current) => ({ ...current, bills: current.bills.map((item) => item.id === billId ? { ...item, status } : item) }));
    setToast(status === "Paid" ? "Bill marked paid; cash balance updated." : `Bill marked ${status.toLowerCase()}.`);
  }
  function removeContact(contact: Contact) {
    if (data.invoices.some((item) => item.contactId === contact.id) || data.bills.some((item) => item.contactId === contact.id)) {
      setToast("This contact is linked to a document, so it can’t be deleted in the demo."); return;
    }
    if (window.confirm(`Delete ${contact.name} from this browser’s demo?`)) setData((current) => ({ ...current, contacts: current.contacts.filter((item) => item.id !== contact.id) }));
  }
  function resetDemo() {
    if (window.confirm("Restore the original sample data in this browser? Your demo edits here will be lost.")) {
      setData(sampleData()); setSearch(""); setPage("Overview"); setToast("Sample data restored in this browser.");
    }
  }

  const primaryAction = page === "Sales" ? () => openForm("invoice") : page === "Purchases" ? () => openForm("bill") : page === "Contacts" ? () => openForm("contact") : page === "Products" ? () => openForm("product") : null;
  const primaryLabel = page === "Sales" ? "New invoice" : page === "Purchases" ? "New bill" : page === "Contacts" ? "New contact" : page === "Products" ? "New item" : "";
  const latestActivity = [
    ...data.invoices.map((item) => ({ id: item.id, title: `${item.number} · ${contactName(item.contactId)}`, date: item.date, amount: item.amount, kind: "Invoice", status: item.status })),
    ...data.bills.map((item) => ({ id: item.id, title: `${item.number} · ${contactName(item.contactId)}`, date: item.date, amount: -item.amount, kind: "Bill", status: item.status })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        {mobileNav && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setMobileNav(false)} />}
        <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-950 text-white transition-transform lg:static lg:translate-x-0 ${mobileNav ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-500"><Building2 className="h-5 w-5" /></div>
            <div><div className="font-bold tracking-tight">LedgerFlow</div><div className="text-[10px] uppercase tracking-[0.18em] text-emerald-300">Learning sandbox</div></div>
            <button className="ml-auto lg:hidden" onClick={() => setMobileNav(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
          </div>
          <div className="px-4 pt-5"><div className="rounded-xl border border-white/10 bg-white/5 p-3"><div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Sample company</div><div className="mt-1 truncate text-sm font-semibold">Akan Design Studio</div><div className="mt-0.5 text-xs text-slate-400">Ghana · GHS</div></div></div>
          <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5">{["Workspace", "Manage", "Insights"].map((group) => <div key={group}><div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{group}</div><div className="space-y-1">{nav.filter((item) => item.group === group).map(({ page: itemPage, icon: Icon }) => <button key={itemPage} onClick={() => { setPage(itemPage); setSearch(""); setMobileNav(false); }} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${page === itemPage ? "bg-emerald-500/15 font-semibold text-emerald-300" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}><Icon className="h-4 w-4" />{itemPage}</button>)}</div></div>)}</nav>
          <div className="border-t border-white/10 p-4"><div className="flex items-start gap-2 rounded-lg bg-amber-400/10 p-3 text-xs leading-5 text-amber-100"><HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /><span>Practice safely. All records here are fictional and saved only in this browser.</span></div></div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
            <div className="flex items-center gap-3"><button onClick={() => setMobileNav(true)} className="rounded-lg p-2 hover:bg-slate-100 lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button><div><div className="text-sm font-semibold">{page}</div><div className="hidden text-xs text-slate-500 sm:block">Akan Design Studio · Learning sandbox</div></div></div>
            <div className="flex items-center gap-2"><span className="hidden rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 sm:inline-flex">Demo data · this browser only</span><button onClick={resetDemo} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"><RotateCcw className="h-3.5 w-3.5" /><span className="hidden sm:inline">Reset sample data</span><span className="sm:hidden">Reset</span></button></div>
          </header>

          <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-4 sm:p-6 lg:p-8">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.17em] text-emerald-700">LedgerFlow · Training mode</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{page === "Overview" ? "Good day, welcome back" : page}</h1><p className="mt-1 text-sm text-slate-500">Explore bookkeeping with fictional Ghana cedi sample records.</p></div>{primaryAction && <button onClick={primaryAction} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"><Plus className="h-4 w-4" />{primaryLabel}</button>}</div>
            <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"><HelpCircle className="mt-0.5 h-4 w-4 shrink-0" /><p><strong>Editable practice space.</strong> You can create, update, and mark records paid. Changes are stored only in this browser and won’t sync to other visitors or devices. Use <strong>Reset sample data</strong> to start over.</p></div>

            {page === "Overview" && <Overview cash={cash} receivable={receivable} payable={payable} profit={profit} activity={latestActivity} onNavigate={setPage} />}
            {page === "Sales" && <DocumentList type="invoice" rows={data.invoices} contactName={contactName} onStatus={updateInvoice} />}
            {page === "Purchases" && <DocumentList type="bill" rows={data.bills} contactName={contactName} onStatus={updateBill} />}
            {page === "Contacts" && <div className="space-y-4"><SearchBox value={search} onChange={setSearch} placeholder="Search contacts" /><div className="grid gap-4 md:grid-cols-2">{filteredContacts.map((contact) => <div key={contact.id} className="flex items-start justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-50 text-sm font-bold text-emerald-700">{contact.name.slice(0, 1).toUpperCase()}</div><div><div className="font-semibold">{contact.name}</div><div className="mt-1 text-xs text-slate-500">{contact.kind}</div><div className="mt-2 text-sm text-slate-600">{contact.email || "No email"}</div><div className="text-sm text-slate-600">{contact.phone || "No phone"}</div></div></div><button title="Delete contact" onClick={() => removeContact(contact)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></div>)}{!filteredContacts.length && <Empty>No contacts match that search.</Empty>}</div></div>}
            {page === "Products" && <div className="space-y-4"><SearchBox value={search} onChange={setSearch} placeholder="Search products and services" /><div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Name</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">SKU</th><th className="px-5 py-3 text-right">Sales price</th><th className="px-5 py-3 text-right">Stock</th><th className="px-5 py-3" /></tr></thead><tbody className="divide-y divide-slate-100">{filteredProducts.map((item) => <tr key={item.id}><td className="px-5 py-4 font-medium">{item.name}</td><td className="px-5 py-4 text-slate-600">{item.kind}</td><td className="px-5 py-4 text-slate-500">{item.sku || "—"}</td><td className="px-5 py-4 text-right">{money(item.price)}</td><td className="px-5 py-4 text-right">{item.kind === "Product" ? item.stock : "—"}</td><td className="px-5 py-4 text-right"><button title="Remove sample item" onClick={() => setData((current) => ({ ...current, products: current.products.filter((x) => x.id !== item.id) }))} className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></td></tr>)}{!filteredProducts.length && <tr><td colSpan={6} className="p-8 text-center text-slate-500">No items found.</td></tr>}</tbody></table></div></div></div>}
            {page === "Banking" && <BankingView cash={cash} invoices={data.invoices} bills={data.bills} contactName={contactName} />}
            {page === "Reports" && <ReportsView income={income} expenses={expenses} receivable={receivable} payable={payable} profit={profit} invoices={data.invoices} bills={data.bills} contactName={contactName} />}
            {page === "Accounts" && <AccountsView cash={cash} receivable={receivable} payable={payable} income={income} expenses={expenses} />}
          </main>
          <footer className="border-t border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500">LedgerFlow public learning demo · Fictional data · Stored locally in this browser</footer>
        </div>
      </div>

      {formKind && <FormModal kind={formKind} form={form} setForm={setForm} contacts={data.contacts} onClose={() => setFormKind(null)} onSubmit={saveForm} />}
      {toast && <div role="status" className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl">{toast}</div>}
    </div>
  );
}

function Overview({ cash, receivable, payable, profit, activity, onNavigate }: { cash: number; receivable: number; payable: number; profit: number; activity: Array<{ id: string; title: string; date: string; amount: number; kind: string; status: Status }>; onNavigate: (page: Page) => void }) {
  return <>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric title="Cash balance" value={money(cash)} icon={Banknote} tone="green" note="Sample bank balance" /><Metric title="Money owed to you" value={money(receivable)} icon={ArrowUpRight} tone="blue" note="Open customer invoices" /><Metric title="Money you owe" value={money(payable)} icon={ArrowDownLeft} tone="amber" note="Unpaid supplier bills" /><Metric title="Net profit" value={money(profit)} icon={BarChart3} tone="violet" note="Recorded income less costs" /></section>
    <section className="grid gap-5 xl:grid-cols-[1.5fr_1fr]"><div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Cash flow snapshot</h2><p className="mt-1 text-xs text-slate-500">Current sample position</p></div><button onClick={() => onNavigate("Reports")} className="text-xs font-semibold text-emerald-700 hover:text-emerald-800">View reports →</button></div><div className="mt-7 flex h-48 items-end gap-3 border-b border-slate-100 px-2">{[{ m: "May", a: 0.42 }, { m: "Jun", a: 0.65 }, { m: "Jul", a: 0.5 }, { m: "Aug", a: 0.82 }, { m: "Sep", a: 0.63 }, { m: "Oct", a: 0.95 }].map((bar) => <div key={bar.m} className="flex flex-1 flex-col items-center gap-2"><div className="flex h-40 w-full items-end justify-center gap-1"><div className="w-3/5 rounded-t-md bg-emerald-500" style={{ height: `${Math.max(14, bar.a * 100)}%` }} /><div className="w-3/5 rounded-t-md bg-amber-300" style={{ height: `${Math.max(10, bar.a * 61)}%` }} /></div><span className="text-[10px] text-slate-500">{bar.m}</span></div>)}</div><div className="mt-3 flex gap-4 text-xs text-slate-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />Money in</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-300" />Money out</span><span className="ml-auto">Illustrative sample</span></div></div><div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Learn by doing</h2><p className="mt-1 text-xs text-slate-500">Try a common bookkeeping task</p></div><BookOpen className="h-5 w-5 text-emerald-600" /></div><div className="mt-4 space-y-2"><QuickAction icon={FileText} label="Create a customer invoice" onClick={() => onNavigate("Sales")} /><QuickAction icon={ShoppingCart} label="Record a supplier bill" onClick={() => onNavigate("Purchases")} /><QuickAction icon={Users} label="Add a customer or vendor" onClick={() => onNavigate("Contacts")} /><QuickAction icon={Boxes} label="Manage products and services" onClick={() => onNavigate("Products")} /></div></div></section>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-semibold">Recent activity</h2><p className="mt-1 text-xs text-slate-500">Latest sample invoices and bills</p></div><ArrowLeftRight className="h-4 w-4 text-slate-400" /></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Transaction</th><th className="px-5 py-3">Date</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Amount</th></tr></thead><tbody className="divide-y divide-slate-100">{activity.map((item) => <tr key={item.id}><td className="px-5 py-4 font-medium">{item.title}</td><td className="px-5 py-4 text-slate-600">{prettyDate(item.date)}</td><td className="px-5 py-4 text-slate-600">{item.kind}</td><td className="px-5 py-4"><Badge status={item.status} /></td><td className={`px-5 py-4 text-right font-medium ${item.amount < 0 ? "text-slate-700" : "text-emerald-700"}`}>{item.amount < 0 ? "−" : "+"}{money(Math.abs(item.amount))}</td></tr>)}</tbody></table></div></section>
  </>;
}

function DocumentList({ type, rows, contactName, onStatus }: { type: "invoice" | "bill"; rows: Array<Invoice | Bill>; contactName: (id: string) => string; onStatus: (id: string, status: Status) => void }) {
  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold">{type === "invoice" ? "Customer invoices" : "Supplier bills"}</h2><p className="mt-1 text-xs text-slate-500">Use the action menu to change a document’s demo status.</p></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Number</th><th className="px-5 py-3">Contact</th><th className="px-5 py-3">Description</th><th className="px-5 py-3">Date</th><th className="px-5 py-3">Due</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Total</th><th className="px-5 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.id}><td className="px-5 py-4 font-semibold text-slate-900">{row.number}</td><td className="px-5 py-4">{contactName(row.contactId)}</td><td className="px-5 py-4 text-slate-600">{row.description}</td><td className="px-5 py-4 text-slate-600">{prettyDate(row.date)}</td><td className="px-5 py-4 text-slate-600">{prettyDate(row.dueDate)}</td><td className="px-5 py-4"><Badge status={row.status} /></td><td className="px-5 py-4 text-right font-medium">{money(row.amount)}</td><td className="px-5 py-4"><select aria-label={`Change ${row.number} status`} value={row.status} onChange={(event) => onStatus(row.id, event.target.value as Status)} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"><option>Draft</option><option>Due</option><option>Paid</option></select></td></tr>)}{!rows.length && <tr><td colSpan={8} className="p-10 text-center text-slate-500">No documents yet. Create one to try the workflow.</td></tr>}</tbody></table></div></div>;
}

function BankingView({ cash, invoices, bills, contactName }: { cash: number; invoices: Invoice[]; bills: Bill[]; contactName: (id: string) => string }) {
  const items = [...invoices.filter((item) => item.status === "Paid").map((item) => ({ id: item.id, date: item.date, memo: `Invoice ${item.number} · ${contactName(item.contactId)}`, amount: item.amount, side: "Money in" })), ...bills.filter((item) => item.status === "Paid").map((item) => ({ id: item.id, date: item.date, memo: `Bill ${item.number} · ${contactName(item.contactId)}`, amount: -item.amount, side: "Money out" }))].sort((a, b) => b.date.localeCompare(a.date));
  return <div className="space-y-5"><div className="grid gap-4 md:grid-cols-3"><Metric title="Sample checking account" value={money(cash)} icon={Wallet} tone="green" note="Balance recalculates from paid documents" /><Metric title="Cleared in demo" value={String(items.length)} icon={Check} tone="blue" note="Paid invoices and bills" /><Metric title="Needs review" value="0" icon={FileText} tone="amber" note="No imported statement in this sandbox" /></div><div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold">Sample bank activity</h2><p className="mt-1 text-xs text-slate-500">Mark invoices or bills as paid to change the sample balance.</p></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Date</th><th className="px-5 py-3">Description</th><th className="px-5 py-3">Flow</th><th className="px-5 py-3 text-right">Amount</th></tr></thead><tbody className="divide-y divide-slate-100">{items.map((item) => <tr key={`${item.side}-${item.id}`}><td className="px-5 py-4">{prettyDate(item.date)}</td><td className="px-5 py-4 font-medium">{item.memo}</td><td className="px-5 py-4">{item.side}</td><td className={`px-5 py-4 text-right font-semibold ${item.amount >= 0 ? "text-emerald-700" : "text-slate-700"}`}>{item.amount >= 0 ? "+" : "−"}{money(Math.abs(item.amount))}</td></tr>)}{!items.length && <tr><td colSpan={4} className="p-10 text-center text-slate-500">No paid documents yet.</td></tr>}</tbody></table></div></div></div>;
}

function ReportsView({ income, expenses, receivable, payable, profit, invoices, bills, contactName }: { income: number; expenses: number; receivable: number; payable: number; profit: number; invoices: Invoice[]; bills: Bill[]; contactName: (id: string) => string }) {
  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric title="Income" value={money(income)} icon={ArrowUpRight} tone="green" note="Issued and paid invoices" /><Metric title="Expenses" value={money(expenses)} icon={ArrowDownLeft} tone="amber" note="Due and paid bills" /><Metric title="Net profit" value={money(profit)} icon={BarChart3} tone="violet" note="Income less expenses" /><Metric title="Net working capital" value={money(receivable - payable)} icon={Banknote} tone="blue" note="Receivables less payables" /></div><div className="grid gap-5 lg:grid-cols-2"><section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold">Open invoices</h2><p className="mt-1 text-xs text-slate-500">Outstanding customer balances · {money(receivable)}</p></div><ReportRows rows={invoices.filter((item) => item.status === "Due").map((item) => ({ id: item.id, name: `${item.number} · ${contactName(item.contactId)}`, amount: item.amount, date: item.dueDate }))} empty="No open invoices." /></section><section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold">Bills to pay</h2><p className="mt-1 text-xs text-slate-500">Outstanding supplier balances · {money(payable)}</p></div><ReportRows rows={bills.filter((item) => item.status === "Due").map((item) => ({ id: item.id, name: `${item.number} · ${contactName(item.contactId)}`, amount: item.amount, date: item.dueDate }))} empty="No bills to pay." /></section></div></div>;
}
function ReportRows({ rows, empty }: { rows: Array<{ id: string; name: string; amount: number; date: string }>; empty: string }) { return <div className="divide-y divide-slate-100">{rows.map((item) => <div key={item.id} className="flex items-center justify-between gap-4 px-5 py-4"><div><div className="text-sm font-medium">{item.name}</div><div className="mt-1 text-xs text-slate-500">Due {prettyDate(item.date)}</div></div><div className="text-sm font-semibold">{money(item.amount)}</div></div>)}{!rows.length && <p className="p-8 text-center text-sm text-slate-500">{empty}</p>}</div>; }
function AccountsView({ cash, receivable, payable, income, expenses }: { cash: number; receivable: number; payable: number; income: number; expenses: number }) { const accounts = [{ code: "1000", name: "Business bank account", type: "Bank", balance: cash }, { code: "1200", name: "Accounts receivable", type: "Asset", balance: receivable }, { code: "2000", name: "Accounts payable", type: "Liability", balance: payable }, { code: "4000", name: "Sales income", type: "Income", balance: income }, { code: "6000", name: "Operating expenses", type: "Expense", balance: expenses }]; return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold">Sample chart of accounts</h2><p className="mt-1 text-xs text-slate-500">Balances update when you change invoices and bills.</p></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Number</th><th className="px-5 py-3">Account</th><th className="px-5 py-3">Type</th><th className="px-5 py-3 text-right">Balance</th></tr></thead><tbody className="divide-y divide-slate-100">{accounts.map((account) => <tr key={account.code}><td className="px-5 py-4 font-mono text-slate-500">{account.code}</td><td className="px-5 py-4 font-medium">{account.name}</td><td className="px-5 py-4 text-slate-600">{account.type}</td><td className="px-5 py-4 text-right font-medium">{money(account.balance)}</td></tr>)}</tbody></table></div></div>; }

function Metric({ title, value, icon: Icon, tone, note }: { title: string; value: string; icon: typeof Banknote; tone: "green" | "blue" | "amber" | "violet"; note: string }) { const colors = { green: "bg-emerald-50 text-emerald-700", blue: "bg-blue-50 text-blue-700", amber: "bg-amber-50 text-amber-700", violet: "bg-violet-50 text-violet-700" }; return <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p><span className={`grid h-9 w-9 place-items-center rounded-lg ${colors[tone]}`}><Icon className="h-4 w-4" /></span></div><div className="mt-3 text-2xl font-bold tracking-tight text-slate-950">{value}</div><p className="mt-1 text-xs text-slate-500">{note}</p></div>; }
function QuickAction({ icon: Icon, label, onClick }: { icon: typeof FileText; label: string; onClick: () => void }) { return <button onClick={onClick} className="flex w-full items-center gap-3 rounded-lg border border-slate-100 p-3 text-left text-sm font-medium text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50"><span className="grid h-8 w-8 place-items-center rounded-md bg-slate-100 text-slate-600"><Icon className="h-4 w-4" /></span>{label}<ChevronDown className="ml-auto h-4 w-4 -rotate-90 text-slate-400" /></button>; }
function Badge({ status }: { status: Status }) { const styles = { Paid: "bg-emerald-50 text-emerald-700", Due: "bg-amber-50 text-amber-800", Draft: "bg-slate-100 text-slate-600" }; return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>{status}</span>; }
function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) { return <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></div>; }
function Empty({ children }: { children: React.ReactNode }) { return <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">{children}</div>; }

function FormModal({ kind, form, setForm, contacts, onClose, onSubmit }: { kind: Exclude<FormKind, null>; form: Record<string, string>; setForm: (value: Record<string, string>) => void; contacts: Contact[]; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  const set = (key: string, value: string) => setForm({ ...form, [key]: value });
  const isDoc = kind === "invoice" || kind === "bill";
  const matchingContacts = contacts.filter((contact) => kind === "invoice" ? contact.kind !== "Vendor" : kind === "bill" ? contact.kind !== "Customer" : true);
  const title = kind === "invoice" ? "Create customer invoice" : kind === "bill" ? "Record supplier bill" : kind === "contact" ? "Add contact" : "Add product or service";
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form onSubmit={onSubmit} className="max-h-[92vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h2 className="text-lg font-bold">{title}</h2><p className="mt-1 text-xs text-slate-500">This record is saved only in your current browser.</p></div><button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
    {isDoc && <><label className="block text-sm font-medium text-slate-700">{kind === "invoice" ? "Customer" : "Vendor"}<select required value={form.contactId || ""} onChange={(event) => set("contactId", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"><option value="">Choose a contact</option>{matchingContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label><label className="block text-sm font-medium text-slate-700">Description<input value={form.description || ""} onChange={(event) => set("description", event.target.value)} required className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" placeholder="What is this for?" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium text-slate-700">Amount (GHS)<input value={form.amount || ""} onChange={(event) => set("amount", event.target.value)} required min="0.01" step="0.01" type="number" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="block text-sm font-medium text-slate-700">Date<input value={form.date || today} onChange={(event) => set("date", event.target.value)} type="date" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="block text-sm font-medium text-slate-700 sm:col-span-2">Due date<input value={form.dueDate || day(14)} onChange={(event) => set("dueDate", event.target.value)} type="date" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label></div></>}
    {kind === "contact" && <><label className="block text-sm font-medium text-slate-700">Display name<input autoFocus required value={form.name || ""} onChange={(event) => set("name", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium text-slate-700">Type<select value={form.kind || "Customer"} onChange={(event) => set("kind", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"><option>Customer</option><option>Vendor</option><option>Both</option></select></label><label className="block text-sm font-medium text-slate-700">Phone<input value={form.phone || ""} onChange={(event) => set("phone", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="block text-sm font-medium text-slate-700 sm:col-span-2">Email<input value={form.email || ""} onChange={(event) => set("email", event.target.value)} type="email" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label></div></>}
    {kind === "product" && <><label className="block text-sm font-medium text-slate-700">Name<input autoFocus required value={form.name || ""} onChange={(event) => set("name", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium text-slate-700">Type<select value={form.kind || "Service"} onChange={(event) => set("kind", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"><option>Service</option><option>Product</option></select></label><label className="block text-sm font-medium text-slate-700">SKU<input value={form.sku || ""} onChange={(event) => set("sku", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="block text-sm font-medium text-slate-700">Sales price (GHS)<input type="number" min="0" step="0.01" value={form.price || ""} onChange={(event) => set("price", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="block text-sm font-medium text-slate-700">Purchase cost (GHS)<input type="number" min="0" step="0.01" value={form.cost || ""} onChange={(event) => set("cost", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label>{form.kind === "Product" && <label className="block text-sm font-medium text-slate-700">Opening stock<input type="number" min="0" step="1" value={form.stock || "0"} onChange={(event) => set("stock", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label>}</div></>}
    <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button><button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Save in this browser</button></div>
  </form></div>;
}
