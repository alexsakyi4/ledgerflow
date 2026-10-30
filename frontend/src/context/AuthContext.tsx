import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import type { AuthContextType, CompanySummary, Membership, User } from "@/types/auth";

const AuthContext = createContext<AuthContextType | null>(null);
const ACTIVE_COMPANY_KEY = "ledgerflow.activeCompanyId";

function asMembership(company: CompanySummary): Membership {
  return {
    id: company.membershipId || company.id,
    membershipId: company.membershipId,
    companyId: company.id,
    companyName: company.name,
    companyCurrency: company.currency,
    role: company.role,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshCompanies = useCallback(async () => {
    const res = await api.get<{ data: CompanySummary[] }>("/companies");
    const list = res.data.data;
    setCompanies(list);
    const savedId = window.localStorage.getItem(ACTIVE_COMPANY_KEY);
    const selected = list.find((company) => company.id === savedId) || list[0];
    if (selected) {
      setMembership(asMembership(selected));
      window.localStorage.setItem(ACTIVE_COMPANY_KEY, selected.id);
    } else {
      setMembership(null);
      window.localStorage.removeItem(ACTIVE_COMPANY_KEY);
    }
    return list;
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const res = await api.get<{ data: { user: User } }>("/auth/me");
      setUser(res.data.data.user);
      try {
        await refreshCompanies();
      } catch {
        setCompanies([]);
        setMembership(null);
      }
    } catch {
      setUser(null);
      setCompanies([]);
      setMembership(null);
    } finally {
      setIsLoading(false);
    }
  }, [refreshCompanies]);

  useEffect(() => {
    void loadSession();
    const onExpired = () => {
      setUser(null);
      setCompanies([]);
      setMembership(null);
      window.localStorage.removeItem(ACTIVE_COMPANY_KEY);
      window.location.href = "/login";
    };
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, [loadSession]);

  const login = async (email: string, password: string): Promise<void> => {
    await api.post("/auth/login", { email, password });
    await loadSession();
  };

  const register = async (data: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
  }): Promise<void> => {
    await api.post("/auth/register", data);
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // The local session is cleared even if the network is unavailable.
    }
    setUser(null);
    setMembership(null);
    setCompanies([]);
    window.localStorage.removeItem(ACTIVE_COMPANY_KEY);
    window.location.href = "/login";
  };

  const refresh = async () => {
    await api.post("/auth/refresh");
    await loadSession();
  };

  const selectCompany = async (companyId: string) => {
    const selected = companies.find((company) => company.id === companyId);
    if (!selected) throw new Error("You do not have access to that company");
    setMembership(asMembership(selected));
    window.localStorage.setItem(ACTIVE_COMPANY_KEY, selected.id);
  };

  const value: AuthContextType = {
    user,
    membership,
    companies,
    isLoading,
    login,
    register,
    logout,
    refresh,
    refreshCompanies,
    selectCompany,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
