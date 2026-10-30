import { FormEvent, useCallback, useEffect, useState } from "react";
import { Plus, Save, UserMinus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type { CompanySummary } from "@/types/auth";

type Member = { id: string; role: string; isActive: boolean; user: { id: string; email: string; firstName: string | null; lastName: string | null; status: string } };
type CompanyProfile = Pick<CompanySummary, "id" | "name" | "legalName" | "legalEntityType" | "currency" | "fiscalYearStart" | "taxId" | "logoUrl"> & { phone?: string | null; email?: string | null; website?: string | null };
const roles = ["ADMIN", "ACCOUNTANT", "BOOKKEEPER", "READ_ONLY"];

export default function CompanySettings() {
  const { membership, refreshCompanies } = useAuth();
  const companyId = membership?.companyId;
  const canManage = ["OWNER", "ADMIN"].includes(membership?.role || "");
  const isOwner = membership?.role === "OWNER";
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState("BOOKKEEPER");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const [companyRes, memberRes] = await Promise.all([
        api.get<{ data: CompanyProfile }>(`/companies/${companyId}`),
        api.get<{ data: Member[] }>(`/companies/${companyId}/members`),
      ]);
      setProfile(companyRes.data.data); setMembers(memberRes.data.data);
    } catch (err: any) { setError(err.response?.data?.error || "Could not load company settings."); }
    finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { void load(); }, [load]);

  async function saveCompany(event: FormEvent) {
    event.preventDefault(); if (!companyId || !profile) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const { data } = await api.patch<{ data: CompanyProfile }>(`/companies/${companyId}`, {
        name: profile.name, legalName: profile.legalName || null, legalEntityType: profile.legalEntityType || null,
        currency: profile.currency, fiscalYearStart: Number(profile.fiscalYearStart), taxId: profile.taxId || null,
        logoUrl: profile.logoUrl || null, phone: profile.phone || null, email: profile.email || null, website: profile.website || null,
      });
      setProfile(data.data); await refreshCompanies(); setNotice("Company settings saved.");
    } catch (err: any) { setError(err.response?.data?.error || "Could not save company settings."); }
    finally { setSaving(false); }
  }

  async function addMember(event: FormEvent) {
    event.preventDefault(); if (!companyId) return;
    setError(""); setNotice("");
    try {
      await api.post(`/companies/${companyId}/members`, { email, role: newRole });
      setEmail(""); await load(); setNotice("User added to this company.");
    } catch (err: any) { setError(err.response?.data?.error || "Could not add user."); }
  }

  async function changeRole(member: Member, role: string) {
    if (!companyId) return;
    try { await api.patch(`/companies/${companyId}/members/${member.id}`, { role }); await load(); }
    catch (err: any) { setError(err.response?.data?.error || "Could not update role."); }
  }

  async function removeMember(member: Member) {
    if (!companyId || !window.confirm(`Remove ${member.user.email} from this company?`)) return;
    try { await api.delete(`/companies/${companyId}/members/${member.id}`); await load(); setNotice("Member removed."); }
    catch (err: any) { setError(err.response?.data?.error || "Could not remove member."); }
  }

  if (!companyId) return <div className="card"><h1 className="text-xl font-bold">Company settings</h1><p className="mt-2 text-sm text-gray-600">Create or select a company to manage settings.</p></div>;
  if (loading) return <div className="card py-12 text-center text-sm text-gray-500">Loading company settings…</div>;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div><h1 className="text-2xl font-bold text-gray-900">Company settings</h1><p className="text-sm text-gray-600">Business profile and user access for {membership?.companyName}.</p></div>
      <div className="card border border-emerald-100 bg-emerald-50/60"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">QuickBooks equivalent</p><p className="mt-1 text-sm text-emerald-900">Settings → Account and settings for your company profile; Manage users for company access and roles.</p></div>
      {(error || notice) && <div role="status" className={`rounded-md px-4 py-3 text-sm ${error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{error || notice}</div>}

      {profile && <form onSubmit={saveCompany} className="card space-y-4">
        <div><h2 className="font-semibold text-gray-900">Business profile</h2><p className="text-xs text-gray-500">The home currency is locked after transactions or opening balances are recorded to protect historical reports.</p></div>
        <div className="grid gap-4 md:grid-cols-2">
          {(["name", "legalName", "legalEntityType", "taxId", "email", "phone", "website", "logoUrl"] as const).map((key) => <label key={key} className="label capitalize">{key.replace(/([A-Z])/g, " $1")}
            <input disabled={!canManage} type={key === "email" ? "email" : key === "website" || key === "logoUrl" ? "url" : "text"} value={(profile[key] || "") as string} onChange={(e) => setProfile({ ...profile, [key]: e.target.value })} className="input mt-1" />
          </label>)}
          <label className="label">Home currency<select disabled={!canManage} value={profile.currency} onChange={(e) => setProfile({ ...profile, currency: e.target.value })} className="input mt-1"><option>GHS</option><option>USD</option><option>GBP</option><option>EUR</option><option>NGN</option></select></label>
          <label className="label">Fiscal year starts in<select disabled={!canManage} value={profile.fiscalYearStart} onChange={(e) => setProfile({ ...profile, fiscalYearStart: Number(e.target.value) })} className="input mt-1">{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Date(2020, i, 1).toLocaleString("en", { month: "long" })}</option>)}</select></label>
        </div>
        {canManage && <div className="flex justify-end"><button disabled={saving} className="btn-primary"><Save className="mr-2 h-4 w-4" />{saving ? "Saving…" : "Save company settings"}</button></div>}
      </form>}

      <section className="card space-y-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="font-semibold text-gray-900">Users and roles</h2><p className="text-xs text-gray-500">Only registered users can be added. They will have access only to this company.</p></div><span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">{members.length} active</span></div>
        {canManage && <form onSubmit={addMember} className="grid gap-3 rounded-lg bg-gray-50 p-4 md:grid-cols-[1fr_220px_auto]">
          <label className="label mb-0">User email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input mt-1" placeholder="user@example.com" /></label>
          <label className="label mb-0">Role<select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="input mt-1">{roles.map((role) => <option key={role} value={role}>{role.replace(/_/g, " ")}</option>)}{isOwner && <option value="OWNER">OWNER</option>}</select></label>
          <button className="btn-primary self-end"><Plus className="mr-2 h-4 w-4" />Add user</button>
        </form>}
        <div className="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Account status</th>{canManage && <th>Access</th>}</tr></thead><tbody>
          {members.map((member) => <tr key={member.id}><td><div className="font-medium">{[member.user.firstName, member.user.lastName].filter(Boolean).join(" ") || member.user.email}</div><div className="text-xs text-gray-500">{member.user.email}</div></td><td>
            {canManage && (member.role !== "OWNER" || isOwner) ? <select aria-label={`Role for ${member.user.email}`} value={member.role} onChange={(e) => void changeRole(member, e.target.value)} className="rounded border border-gray-200 bg-white px-2 py-1 text-xs">{roles.map((role) => <option key={role}>{role}</option>)}{isOwner && <option>OWNER</option>}</select> : <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs">{member.role.replace(/_/g, " ")}</span>}
          </td><td><span className="text-xs text-gray-600">{member.user.status}</span></td>{canManage && <td><button onClick={() => void removeMember(member)} disabled={member.role === "OWNER" && !isOwner} title={member.role === "OWNER" && !isOwner ? "Only an owner can remove an owner" : "Remove access"} className="rounded p-2 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><UserMinus className="h-4 w-4" /></button></td>}</tr>)}
          {members.length === 0 && <tr><td colSpan={canManage ? 4 : 3} className="py-8 text-center text-sm text-gray-500">No company members found.</td></tr>}
        </tbody></table></div>
      </section>
    </div>
  );
}
