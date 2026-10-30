import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

type Rate = { id: string; baseCurrency: string; quoteCurrency: string; rateDate: string; rate: string | number; source?: string | null };
export default function ExchangeRatesPage() {
  const { membership } = useAuth();
  const companyId = membership?.companyId;
  const [homeCurrency, setHomeCurrency] = useState("GHS");
  const [rates, setRates] = useState<Rate[]>([]);
  const [baseCurrency, setBaseCurrency] = useState("USD");
  const [rate, setRate] = useState("");
  const [rateDate, setRateDate] = useState(new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const [company, result] = await Promise.all([
        api.get<{ data: { currency: string } }>(`/companies/${companyId}`),
        api.get<{ data: Rate[] }>(`/companies/${companyId}/currency-rates`),
      ]);
      setHomeCurrency(company.data.data.currency); setRates(result.data.data);
    } catch (e: any) { setError(e.response?.data?.error || "Could not load exchange rates."); }
  }, [companyId]);
  useEffect(() => { void load(); }, [load]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!companyId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api.post(`/companies/${companyId}/currency-rates`, { baseCurrency, quoteCurrency: homeCurrency, rate: Number(rate), rateDate, source: source || undefined });
      setRate(""); setNotice(`Saved ${baseCurrency} → ${homeCurrency} exchange rate.`); await load();
    } catch (e: any) { setError(e.response?.data?.error || "Could not save the exchange rate."); }
    finally { setBusy(false); }
  }
  async function remove(item: Rate) {
    if (!companyId || !window.confirm(`Delete ${item.baseCurrency}/${item.quoteCurrency} rate for ${new Date(item.rateDate).toLocaleDateString()}?`)) return;
    try { await api.delete(`/companies/${companyId}/currency-rates/${item.id}`); await load(); }
    catch (e: any) { setError(e.response?.data?.error || "Could not delete the rate."); }
  }
  if (!companyId) return <div className="card">Create or select a company to manage exchange rates.</div>;
  return <div className="mx-auto max-w-5xl space-y-6"><header><h1 className="text-2xl font-bold">Currency exchange rates</h1><p className="text-sm text-gray-600">Enter the number of {homeCurrency} for one unit of foreign currency. Rates are company-scoped and dated.</p></header>
    {(error || notice) && <p role="status" className={`rounded p-3 text-sm ${error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{error || notice}</p>}
    <form className="card grid gap-3 md:grid-cols-5" onSubmit={save}><label className="label">Foreign currency<input required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" className="input mt-1 uppercase" value={baseCurrency} onChange={e => setBaseCurrency(e.target.value.toUpperCase())} placeholder="USD" /></label><label className="label">Home currency<input disabled className="input mt-1" value={homeCurrency} /></label><label className="label">Rate<input required type="number" min="0.00000001" step="0.00000001" className="input mt-1" value={rate} onChange={e => setRate(e.target.value)} placeholder="e.g. 12.50" /></label><label className="label">Effective date<input required type="date" className="input mt-1" value={rateDate} onChange={e => setRateDate(e.target.value)} /></label><label className="label">Source<input maxLength={80} className="input mt-1" value={source} onChange={e => setSource(e.target.value)} placeholder="Bank of Ghana" /></label><div className="md:col-span-5 flex justify-end"><button disabled={busy} className="btn-primary">{busy ? "Saving…" : "Save exchange rate"}</button></div></form>
    <section className="card"><div className="mb-4"><h2 className="font-semibold">Rate history</h2><p className="text-xs text-gray-500">Transactions use the most recent rate on or before their transaction date. Inverse rates are supported.</p></div><div className="table-wrap"><table><thead><tr><th>Pair</th><th>Effective date</th><th>Rate</th><th>Source</th><th /></tr></thead><tbody>{rates.map(item => <tr key={item.id}><td>{item.baseCurrency} / {item.quoteCurrency}</td><td>{new Date(item.rateDate).toLocaleDateString()}</td><td>{Number(item.rate).toFixed(8)}</td><td>{item.source || "—"}</td><td><button onClick={() => void remove(item)} className="text-sm text-red-600">Delete</button></td></tr>)}{!rates.length && <tr><td colSpan={5} className="py-8 text-center text-sm text-gray-500">No exchange rates saved yet.</td></tr>}</tbody></table></div></section>
  </div>;
}
