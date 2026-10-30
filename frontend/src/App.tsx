import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import Dashboard from "@/pages/dashboard/Dashboard";
import Layout from "@/components/layout/Layout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
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

function PublicRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function PrivateRoutes() {
  return (
    <Routes>
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/accounting" element={<ProtectedRoute><ChartOfAccounts /></ProtectedRoute>} />
      <Route path="/sales" element={<ProtectedRoute><ContactsPage /></ProtectedRoute>} />
      <Route path="/sales/invoices" element={<ProtectedRoute><TransactionsPage group="sales" /></ProtectedRoute>} />
      <Route path="/products" element={<ProtectedRoute><ProductsPage /></ProtectedRoute>} />
      <Route path="/expenses" element={<ProtectedRoute><TransactionsPage group="purchases" /></ProtectedRoute>} />
      <Route path="/banking" element={<ProtectedRoute><BankingPage /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><ReportsPage /></ProtectedRoute>} />
      <Route path="/taxes" element={<ProtectedRoute><TaxesPage /></ProtectedRoute>} />
      <Route path="/companies/new" element={<ProtectedRoute><CompanySetup /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><CompanySettings /></ProtectedRoute>} />
      <Route path="/settings/currency-rates" element={<ProtectedRoute><ExchangeRatesPage /></ProtectedRoute>} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-50">
        <PublicRoutes />
        <Layout>
          <PrivateRoutes />
        </Layout>
      </div>
    </AuthProvider>
  );
}
