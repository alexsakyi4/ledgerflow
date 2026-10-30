import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import Dashboard from "@/pages/dashboard/Dashboard";
import Layout from "@/components/layout/Layout";
import ChartOfAccounts from "@/pages/accounting/ChartOfAccounts";
import CompanySetup from "@/pages/companies/CompanySetup";
import CompanySettings from "@/pages/settings/CompanySettings";
import ExchangeRatesPage from "@/pages/settings/ExchangeRatesPage";
import ContactsPage from "@/pages/sales/ContactsPage";
import ProductsPage from "@/pages/products/ProductsPage";
import BankingPage from "@/pages/banking/BankingPage";
import ReportsPage from "@/pages/reports/ReportsPage";
import TaxesPage from "@/pages/taxes/TaxesPage";
import TransactionsPage from "@/pages/sales/TransactionsPage";

function ProtectedLayout() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-qb-green" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route element={<ProtectedLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/accounting" element={<ChartOfAccounts />} />
        <Route path="/sales" element={<ContactsPage />} />
        <Route path="/sales/invoices" element={<TransactionsPage group="sales" />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/expenses" element={<TransactionsPage group="purchases" />} />
        <Route path="/banking" element={<BankingPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/taxes" element={<TaxesPage />} />
        <Route path="/companies/new" element={<CompanySetup />} />
        <Route path="/settings" element={<CompanySettings />} />
        <Route path="/settings/currency-rates" element={<ExchangeRatesPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-50">
        <AppRoutes />
      </div>
    </AuthProvider>
  );
}
