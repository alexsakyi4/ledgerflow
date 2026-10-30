export interface User {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
}

export interface Membership {
  id: string;
  membershipId?: string;
  companyId: string;
  companyName: string;
  companyCurrency: string;
  role: string;
}

export interface CompanySummary {
  id: string;
  membershipId: string;
  name: string;
  legalName?: string | null;
  legalEntityType?: string | null;
  fiscalYearStart: number;
  currency: string;
  taxId?: string | null;
  logoUrl?: string | null;
  isActive: boolean;
  role: string;
  memberCount?: number;
  accountCount?: number;
}

export interface AuthContextType {
  user: User | null;
  membership: Membership | null;
  companies: CompanySummary[];
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshCompanies: () => Promise<CompanySummary[]>;
  selectCompany: (companyId: string) => Promise<void>;
  isAuthenticated: boolean;
}
