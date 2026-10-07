import {
  Banknote, Building2, CalendarClock, FileText, History, KeyRound, LayoutDashboard, LifeBuoy, Package, Receipt, Router, Settings, ShieldCheck, User, Users, Wifi,
} from 'lucide-react';
import PortalLayout, { type NavItem } from './PortalLayout';
import { useAdminStats } from '../pages/admin/Dashboard';
import { isStaffRole, useAuth } from '../lib/auth';

const accountNav: NavItem[] = [
  { to: '/account', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/account/subscribe', label: 'Packages', icon: Wifi },
  { to: '/account/billing', label: 'Billing & receipts', icon: Receipt },
  { to: '/account/support', label: 'Support', icon: LifeBuoy },
  { to: '/account/profile', label: 'Profile', icon: User },
];

export function AccountLayout() {
  return <PortalLayout nav={accountNav} area="account" />;
}

export function AdminLayout() {
  const { user } = useAuth();
  const { data } = useAdminStats(isStaffRole(user?.role));
  const nav: NavItem[] = [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/admin/customers', label: 'Customers', icon: Users },
    { to: '/admin/payments', label: 'Payments', icon: Banknote, badge: data?.pendingPayments },
    { to: '/admin/network', label: 'Network access', icon: Router, badge: data?.networkTodo },
    { to: '/admin/subscriptions', label: 'Subscriptions', icon: CalendarClock },
    { to: '/admin/invoices', label: 'Invoices', icon: FileText },
    { to: '/admin/support', label: 'Support', icon: LifeBuoy, badge: data?.openTickets },
    { to: '/admin/packages', label: 'Packages', icon: Package },
    { to: '/admin/offices', label: 'Offices', icon: Building2 },
    { to: '/admin/settings', label: 'Settings', icon: Settings },
    { to: '/admin/staff', label: 'Staff', icon: ShieldCheck, superOnly: true },
    { to: '/admin/audit', label: 'Activity log', icon: History },
    { to: '/admin/password', label: 'My password', icon: KeyRound },
  ];
  return <PortalLayout nav={nav} area="admin" />;
}
