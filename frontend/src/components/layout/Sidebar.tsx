import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  LayoutDashboard,
  CreditCard,
  ShoppingCart,
  DollarSign,
  BookOpen,
  BarChart3,
  FileText,
  Settings,
  ChevronLeft,
  LogOut,
  Package,
} from "lucide-react";

const navItems = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Sales", href: "/sales", icon: ShoppingCart },
  { name: "Expenses", href: "/expenses", icon: CreditCard },
  {
    name: "Products and Services",
    href: "/products",
    icon: Package,
  },
  { name: "Banking", href: "/banking", icon: CreditCard },
  { name: "Accounting", href: "/accounting", icon: BookOpen },
  { name: "Reports", href: "/reports", icon: BarChart3 },
  { name: "Taxes", href: "/taxes", icon: FileText },
  { name: "Settings", href: "/settings", icon: Settings },
  { name: "Exchange rates", href: "/settings/currency-rates", icon: DollarSign },
];

export default function Sidebar({
  open,
  onToggle,
  user,
  membership,
}: {
  open: boolean;
  onToggle: (v: boolean) => void;
  user: { firstName?: string | null; lastName?: string | null; email: string };
  membership: { companyName: string; role: string } | null;
}) {
  const navigate = useNavigate();
  const { logout } = useAuth();

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-20 bg-gray-900/60 backdrop-blur-sm lg:hidden" onClick={() => onToggle(false)} />
      )}
      {/* Desktop sidebar */}
      <aside className={`fixed left-0 top-0 h-full w-64 bg-white border-r border-gray-200 z-30 transform transition-transform duration-300 ${open ? "translate-x-0" : "-translate-x-full"} lg:relative lg:translate-x-0 lg:w-64 lg:shadow-none lg:border-r lg:border-gray-200`}>
        <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="bg-qb-green p-2 rounded-lg">
              <DollarSign className="w-6 h-6 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight text-gray-900">LedgerFlow</span>
          </Link>
          <button
            onClick={() => onToggle(false)}
            className="lg:hidden p-2 text-gray-500 hover:text-gray-900"
            aria-label="Close sidebar"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        </div>

        <div className="p-4 space-y-1">
          {membership && (
            <div className="px-4 py-3 border rounded-lg bg-gray-50 border-gray-100">
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Company
              </p>
              <p className="text-sm font-medium text-gray-900 truncate">{membership.companyName}</p>
              <p className="text-xs text-gray-500">{membership.role}</p>
            </div>
          )}
        </div>

        <nav className="mt-4 px-3 space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => { onToggle(false); navigate(item.href); }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors"
              >
                <Icon className="w-5 h-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto p-4 border-t border-gray-200">
          <div className="px-3 py-2 rounded-md bg-gray-50 border border-gray-100">
            <p className="text-xs font-medium text-gray-900">{user.firstName || ""} {user.lastName || ""}</p>
            <p className="text-xs text-gray-500 truncate">{user.email}</p>
          </div>
          <button
            onClick={() => void logout()}
            className="mt-3 w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-md transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
