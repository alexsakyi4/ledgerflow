import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type { CompanySummary } from "@/types/auth";

const entityTypes = ["Sole Proprietorship", "Partnership", "Limited Liability Company", "Corporation", "Nonprofit", "Other"];
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function CompanySetup() {
  const navigate = useNavigate();
  const { refreshCompanies, selectCompany } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    legalName: "",
    legalEntityType: "Sole Proprietorship",
    fiscalYearStart: 1,
    currency: "GHS",
    taxId: "",
    logoUrl: "",
    email: "",
    phone: "",
    website: "",
    taxEnabled: true,
  });

  function field<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await api.post<{ data: CompanySummary }>("/companies", {
        name: form.name,
        legalName: form.legalName || null,
        legalEntityType: form.legalEntityType,
        fiscalYearStart: Number(form.fiscalYearStart),
        currency: form.currency,
        taxId: form.taxId || null,
        logoUrl: form.logoUrl || null,
        email: form.email || null,
        phone: form.phone || null,
        website: form.website || null,
        taxSettings: { enabled: form.taxEnabled },
      });
      await refreshCompanies();
      await selectCompany(response.data.data.id);
      navigate("/dashboard");
    } catch (err: any) {
      setError(err.response?.data?.error || "Could not create the company. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald-100 p-3 text-emerald-700"><Building2 className="h-6 w-6" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Set up your company</h1>
            <p className="text-sm text-gray-600">Create a company workspace and its starting Chart of Accounts.</p>
          </div>
        </div>
      </div>
      <div className="card border border-emerald-100 bg-emerald-50/60">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">QuickBooks equivalent</p>
        <p className="mt-1 text-sm text-emerald-900">Company setup — enter your business details, accounting year, home currency, and tax preferences. A starter Chart of Accounts is created automatically.</p>
      </div>

      <form onSubmit={submit} className="space-y-6">
        <section className="card space-y-4">
          <h2 className="font-semibold text-gray-900">Business details</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-gray-700 space-y-1">Company name *
              <input required maxLength={120} value={form.name} onChange={(e) => field("name", e.target.value)} className="input" placeholder="e.g. Adom Traders Ltd" />
            </label>
            <label className="block text-sm font-medium text-gray-700 space-y-1">Legal name
              <input value={form.legalName} onChange={(e) => field("legalName", e.target.value)} className="input" placeholder="Registered legal name" />
            </label>
            <label className="block text-sm font-medium text-gray-700 space-y-1">Legal entity type
              <select value={form.legalEntityType} onChange={(e) => field("legalEntityType", e.target.value)} className="input">
                {entityTypes.map((type) => <option key={type}>{type}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-gray-700 space-y-1">Tax ID
              <input value={form.taxId} onChange={(e) => field("taxId", e.target.value)} className="input" placeholder="Tax identification number" />
            </label>
            <label className="block text-sm font-medium text-gray-700 space-y-1">Business email
              <input type="email" value={form.email} onChange={(e) => field("email", e.target.value)} className="input" placeholder="accounts@example.com" />
            </label>
            <label className="block text-sm font-medium text-gray-700 space-y-1">Phone
              <input value={form.phone} onChange={(e) => field("phone", e.target.value)} className="input" placeholder="+233 …" />
            </label>
            <label className="block text-sm font-medium text-gray-700 space-y-1 md:col-span-2">Website or logo URL
              <div className="grid gap-3 sm:grid-cols-2">
                <input type="url" value={form.website} onChange={(e) => field("website", e.target.value)} className="input" placeholder="https://example.com" />
                <input type="url" value={form.logoUrl} onChange={(e) => field("logoUrl", e.target.value)} className="input" placeholder="Logo URL (optional)" />
              </div>
            </label>
          </div>
        </section>

        <section className="card space-y-4">
          <h2 className="font-semibold text-gray-900">Accounting preferences</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-gray-700 space-y-1">Fiscal year starts in
              <select value={form.fiscalYearStart} onChange={(e) => field("fiscalYearStart", Number(e.target.value))} className="input">
                {months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-gray-700 space-y-1">Home currency
              <select value={form.currency} onChange={(e) => field("currency", e.target.value)} className="input">
                <option value="GHS">GHS — Ghana cedi</option><option value="USD">USD — US dollar</option><option value="GBP">GBP — Pound sterling</option><option value="EUR">EUR — Euro</option><option value="NGN">NGN — Nigerian naira</option>
              </select>
            </label>
            <label className="md:col-span-2 flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-4">
              <input type="checkbox" checked={form.taxEnabled} onChange={(e) => field("taxEnabled", e.target.checked)} className="mt-1 h-4 w-4 accent-emerald-600" />
              <span><span className="block text-sm font-medium text-gray-900">Enable tax tracking</span><span className="mt-1 block text-xs text-gray-500">You can configure tax rates and rules later under Taxes.</span></span>
            </label>
          </div>
        </section>

        <div className="flex flex-col-reverse items-center justify-between gap-3 sm:flex-row">
          {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : <p className="flex items-center gap-2 text-xs text-gray-500"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> You will become the Owner of this company.</p>}
          <div className="flex gap-3">
            <button type="button" onClick={() => navigate(-1)} className="btn-outline">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? "Creating…" : "Create company"}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
