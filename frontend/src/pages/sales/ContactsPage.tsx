import { FormEvent, useCallback, useEffect, useState } from "react";
import { Archive, Eye, Pencil, Plus, Search, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import CsvImportPanel from "@/components/import/CsvImportPanel";

type Contact = { id: string; type: "CUSTOMER" | "VENDOR" | "BOTH"; displayName: string; companyName: string | null; email: string | null; phone: string | null; paymentTermsDays: number; taxId: string | null; currency: string; balanceCurrency?: string; receivableBalance?: string; payableBalance?: string; isArchived: boolean; currentBalance?: string; documents?: Array<{ id: string; type: string; number: string; issueDate: string; dueDate: string | null; total: string; amountPaid: string; status: string; currency: string }> };
type FormValues = { type: Contact["type"]; displayName: string; companyName: string; email: string; phone: string; paymentTermsDays: number; taxId: string; currency: string };
const initialForm: FormValues = { type: "CUSTOMER", displayName: "", companyName: "", email: "", phone: "", paymentTermsDays: 0, taxId: "", currency: "GHS" };

export default function ContactsPage() {
  const { membership } = useAuth();
  const companyId = membership?.companyId;
  const [tab, setTab] = useState<"CUSTOMER" | "VENDOR">("CUSTOMER");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [homeCurrency, setHomeCurrency] = useState("GHS");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [detail, setDetail] = useState<Contact | null>(null);
  const [form, setForm] = useState<FormValues>(initialForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    setLoading(true);
    try { const [response, company] = await Promise.all([api.get<{ data: Contact[] }>(`/companies/${companyId}/contacts`, { params: { type: tab, search } }), api.get<{ data: { currency: string } }>(`/companies/${companyId}`)]); setContacts(response.data.data); setHomeCurrency(company.data.data.currency); }
    catch (err: any) { setError(err.response?.data?.error || "Could not load contacts."); }
    finally { setLoading(false); }
  }, [companyId, tab, search]);
  useEffect(() => { void load(); }, [load]);

  function startCreate() { setEditing(null); setForm({ ...initialForm, type: tab, currency: homeCurrency }); setError(""); setModal(true); }
  function startEdit(contact: Contact) { setEditing(contact); setForm({ type: contact.type, displayName: contact.displayName, companyName: contact.companyName || "", email: contact.email || "", phone: contact.phone || "", paymentTermsDays: contact.paymentTermsDays, taxId: contact.taxId || "", currency: contact.currency }); setError(""); setModal(true); }

  async function save(event: FormEvent) {
    event.preventDefault(); if (!companyId) return;
    setSaving(true); setError("");
    try {
      const payload = { ...form, companyName: form.companyName || null, email: form.email || null, phone: form.phone || null, taxId: form.taxId || null };
      if (editing) await api.patch(`/companies/${companyId}/contacts/${editing.id}`, payload);
      else await api.post(`/companies/${companyId}/contacts`, payload);
      setModal(false); await load();
    } catch (err: any) { setError(err.response?.data?.error || "Could not save contact."); }
    finally { setSaving(false); }
  }

  async function openDetails(contact: Contact) {
    if (!companyId) return;
    try { const response = await api.get<{ data: Contact }>(`/companies/${companyId}/contacts/${contact.id}`); setDetail(response.data.data); }
    catch (err: any) { setError(err.response?.data?.error || "Could not load contact detail."); }
  }

  async function archive(contact: Contact) {
    if (!companyId || !window.confirm(`Archive ${contact.displayName}?`)) return;
    try { await api.delete(`/companies/${companyId}/contacts/${contact.id}`); await load(); }
    catch (err: any) { setError(err.response?.data?.error || "Could not archive contact."); }
  }

  async function mergeContact(source: Contact) {
    const candidates = contacts.filter((item) => item.id !== source.id && item.type === source.type);
    if (!companyId || !candidates.length) { setError("Add another contact of this type before merging."); return; }
    const targetEmail = window.prompt(`Merge ${source.displayName} into the contact email below:\n${candidates.map((item) => `${item.displayName} — ${item.email || item.id}`).join("\n")}`);
    if (!targetEmail) return;
    const target = candidates.find((item) => item.email?.toLowerCase() === targetEmail.toLowerCase() || item.displayName.toLowerCase() === targetEmail.toLowerCase());
    if (!target) { setError("No contact matched that email or exact name."); return; }
    try { await api.post(`/companies/${companyId}/contacts/${source.id}/merge`, { targetId: target.id }); await load(); }
    catch (err: any) { setError(err.response?.data?.error || "Could not merge contacts."); }
  }

  if (!companyId) return <div className="card">Create or select a company to manage contacts.</div>;
  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h1 className="text-2xl font-bold">{tab === "CUSTOMER" ? "Customers" : "Vendors"}</h1><p className="text-sm text-gray-600">Manage contact details, balances and transaction history.</p></div><button onClick={startCreate} className="btn-primary"><Plus className="mr-2 h-4 w-4" />New {tab === "CUSTOMER" ? "customer" : "vendor"}</button></div>
    <div className="flex flex-wrap gap-2"><Link to="/sales/invoices" className="btn-outline">Invoices & Estimates</Link><Link to="/expenses" className="btn-outline">Bills & Expenses</Link></div>
    <div className="card border border-emerald-100 bg-emerald-50/60"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">QuickBooks equivalent</p><p className="mt-1 text-sm text-emerald-900">Sales → Customers or Expenses → Vendors. Add, search, edit, archive or merge contacts; open a contact to review its balance and transaction history.</p></div>
    <div className="flex flex-col gap-3 sm:flex-row"><div className="flex gap-2 rounded-lg bg-gray-100 p-1"><button onClick={() => setTab("CUSTOMER")} className={`rounded-md px-4 py-2 text-sm ${tab === "CUSTOMER" ? "bg-white shadow-sm" : "text-gray-600"}`}>Customers</button><button onClick={() => setTab("VENDOR")} className={`rounded-md px-4 py-2 text-sm ${tab === "VENDOR" ? "bg-white shadow-sm" : "text-gray-600"}`}>Vendors</button></div><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-9" placeholder="Search name, email or phone" /></div></div>
    <CsvImportPanel entity={tab === "CUSTOMER" ? "CUSTOMERS" : "VENDORS"} onImported={() => void load()} />
    {error && !modal && <div role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="card !p-0 overflow-hidden">{loading ? <p className="p-10 text-center text-sm text-gray-500">Loading contacts…</p> : <div className="table-wrap"><table><thead><tr><th>Name</th><th>Company</th><th>Email / phone</th><th>Terms</th><th>Balance</th><th>Actions</th></tr></thead><tbody>{contacts.map((contact) => <tr key={contact.id}><td><div className="font-medium">{contact.displayName}</div><div className="text-xs text-gray-500">{contact.type === "BOTH" ? "Customer & vendor" : contact.type.toLowerCase()}</div></td><td>{contact.companyName || "—"}</td><td>{contact.email || "—"}<div className="text-xs text-gray-500">{contact.phone || ""}</div></td><td>{contact.paymentTermsDays ? `Net ${contact.paymentTermsDays}` : "Due on receipt"}</td><td>{new Intl.NumberFormat(undefined, { style: "currency", currency: contact.balanceCurrency || homeCurrency }).format(Number(contact.currentBalance || 0))}</td><td><div className="flex gap-1"><button title="View details" onClick={() => void openDetails(contact)} className="rounded p-2 hover:bg-gray-100"><Eye className="h-4 w-4" /></button><button title="Edit" onClick={() => startEdit(contact)} className="rounded p-2 hover:bg-gray-100"><Pencil className="h-4 w-4" /></button><button title="Merge" onClick={() => void mergeContact(contact)} className="rounded p-2 text-gray-500 hover:bg-gray-100"><Users className="h-4 w-4" /></button><button title="Archive" onClick={() => void archive(contact)} className="rounded p-2 text-gray-500 hover:bg-red-50 hover:text-red-600"><Archive className="h-4 w-4" /></button></div></td></tr>)}{contacts.length===0 && <tr><td colSpan={6} className="py-10 text-center text-gray-500">No contacts found.</td></tr>}</tbody></table></div>}</div>
    {modal && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"><form onSubmit={save} className="w-full max-w-2xl space-y-4 rounded-xl bg-white p-6 shadow-xl"><h2 className="text-lg font-semibold">{editing ? "Edit contact" : `New ${tab.toLowerCase()}`}</h2><div className="grid gap-4 sm:grid-cols-2"><label className="label">Contact type<select className="input mt-1" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as FormValues["type"] })}><option value="CUSTOMER">Customer</option><option value="VENDOR">Vendor</option><option value="BOTH">Customer and vendor</option></select></label><label className="label">Display name *<input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className="input mt-1" /></label><label className="label">Company<input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} className="input mt-1" /></label><label className="label">Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input mt-1" /></label><label className="label">Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input mt-1" /></label><label className="label">Payment terms (days)<input type="number" min="0" max="365" value={form.paymentTermsDays} onChange={(e) => setForm({ ...form, paymentTermsDays: Number(e.target.value) })} className="input mt-1" /></label><label className="label">Tax ID<input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} className="input mt-1" /></label><label className="label">Currency<select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="input mt-1"><option>GHS</option><option>USD</option><option>GBP</option><option>EUR</option><option>NGN</option>{!["GHS","USD","GBP","EUR","NGN"].includes(homeCurrency)&&<option>{homeCurrency}</option>}</select></label></div>{error && <p className="text-sm text-red-600">{error}</p>}<div className="flex justify-end gap-2"><button type="button" onClick={() => setModal(false)} className="btn-outline">Cancel</button><button disabled={saving} className="btn-primary">{saving ? "Saving…" : "Save contact"}</button></div></form></div>}
    {detail && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}><div onClick={(e) => e.stopPropagation()} className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-xl bg-white p-6 shadow-xl"><div className="flex justify-between"><div><h2 className="text-xl font-semibold">{detail.displayName}</h2><p className="text-sm text-gray-500">{detail.email || "No email"} · {detail.phone || "No phone"}</p></div><button onClick={() => setDetail(null)} className="btn-outline">Close</button></div><div className="my-5 rounded-lg bg-gray-50 p-4"><p className="text-xs uppercase text-gray-500">{detail.type === "BOTH" ? "Net balance" : "Current balance"}</p><p className="text-2xl font-bold">{new Intl.NumberFormat(undefined, { style: "currency", currency: detail.balanceCurrency || homeCurrency }).format(Number(detail.currentBalance || 0))}</p>{detail.type === "BOTH" && <p className="mt-1 text-xs text-gray-600">A/R {new Intl.NumberFormat(undefined,{style:"currency",currency:detail.balanceCurrency||homeCurrency}).format(Number(detail.receivableBalance||0))} · A/P {new Intl.NumberFormat(undefined,{style:"currency",currency:detail.balanceCurrency||homeCurrency}).format(Number(detail.payableBalance||0))}</p>}</div><h3 className="mb-2 font-semibold">Recent transactions</h3><div className="table-wrap"><table><thead><tr><th>Type / number</th><th>Date</th><th>Due date</th><th>Status</th><th>Total</th></tr></thead><tbody>{(detail.documents || []).map((doc) => <tr key={doc.id}><td>{doc.type.replace(/_/g, " ")} · {doc.number}</td><td>{new Date(doc.issueDate).toLocaleDateString()}</td><td>{doc.dueDate ? new Date(doc.dueDate).toLocaleDateString() : "—"}</td><td>{doc.status.replace(/_/g, " ")}</td><td>{new Intl.NumberFormat(undefined,{style:"currency",currency:doc.currency||detail.balanceCurrency||homeCurrency}).format(Number(doc.total))}</td></tr>)}{!detail.documents?.length && <tr><td colSpan={5} className="py-8 text-center text-sm text-gray-500">No transactions yet.</td></tr>}</tbody></table></div></div></div>}
  </div>;
}
