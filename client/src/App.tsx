import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './lib/auth';
import PublicLayout from './layouts/PublicLayout';
import { AccountLayout, AdminLayout } from './layouts/Portals';
import Home from './pages/public/Home';
import { HowItWorks, Packages, Support } from './pages/public/Info';
import { Login, Register } from './pages/public/Auth';
import Dashboard from './pages/account/Dashboard';
import Subscribe from './pages/account/Subscribe';
import InvoicePage from './pages/account/InvoicePage';
import { Billing, Profile, SupportList, SupportTicketPage } from './pages/account/Other';
import AdminDashboard from './pages/admin/Dashboard';
import Customers from './pages/admin/Customers';
import CustomerDetail from './pages/admin/CustomerDetail';
import Payments, { Invoices } from './pages/admin/Payments';
import Network, { Subscriptions } from './pages/admin/Network';
import { Offices, Packages as AdminPackages } from './pages/admin/Catalog';
import { AdminSupport, AdminTicket, AuditLog, ChangeOwnPassword, Settings, StaffPage } from './pages/admin/Manage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 } },
});

function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-5xl font-extrabold text-slate-300">404</p>
      <p className="mt-2 text-slate-600">This page doesn’t exist.</p>
      <Link to="/" className="mt-4 font-semibold text-brand-700">Go home</Link>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<PublicLayout />}>
              <Route index element={<Home />} />
              <Route path="packages" element={<Packages />} />
              <Route path="how-it-works" element={<HowItWorks />} />
              <Route path="support" element={<Support />} />
              <Route path="*" element={<NotFound />} />
            </Route>
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />

            <Route path="account" element={<AccountLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="subscribe" element={<Subscribe />} />
              <Route path="invoices/:id" element={<InvoicePage />} />
              <Route path="billing" element={<Billing />} />
              <Route path="support" element={<SupportList />} />
              <Route path="support/:id" element={<SupportTicketPage />} />
              <Route path="profile" element={<Profile />} />
              <Route path="*" element={<NotFound />} />
            </Route>

            <Route path="admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="customers" element={<Customers />} />
              <Route path="customers/:id" element={<CustomerDetail />} />
              <Route path="payments" element={<Payments />} />
              <Route path="invoices" element={<Invoices />} />
              <Route path="subscriptions" element={<Subscriptions />} />
              <Route path="network" element={<Network />} />
              <Route path="packages" element={<AdminPackages />} />
              <Route path="offices" element={<Offices />} />
              <Route path="support" element={<AdminSupport />} />
              <Route path="support/:id" element={<AdminTicket />} />
              <Route path="settings" element={<Settings />} />
              <Route path="staff" element={<StaffPage />} />
              <Route path="audit" element={<AuditLog />} />
              <Route path="password" element={<ChangeOwnPassword />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
