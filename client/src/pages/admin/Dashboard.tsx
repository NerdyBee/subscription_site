import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Banknote, Building2, CircleCheck, Clock, LifeBuoy, RefreshCw, Router, Users, XCircle } from 'lucide-react';
import { RevenueChart } from '../../components/RevenueChart';
import { Button, Card, CardHeader, Empty, PageHeader, Spinner, Stat, StatusBadge } from '../../components/ui';
import { api } from '../../lib/api';
import { naira, timeAgo } from '../../lib/format';
import { useTitle } from '../../lib/site';
import type { Payment } from '../../lib/types';

export interface AdminStats {
  customers: { total: number; ACTIVE: number; EXPIRING: number; EXPIRED: number; SUSPENDED: number; NO_SUBSCRIPTION: number };
  activeSubscribers: number;
  officesConnected: number;
  revenueThisMonthKobo: number;
  revenueByMonth: { month: string; totalKobo: number }[];
  pendingPayments: number;
  unpaidInvoices: number;
  openTickets: number;
  networkTodo: number;
  recentPayments: Payment[];
}

export const useAdminStats = (enabled = true) =>
  useQuery({ queryKey: ['admin-stats'], queryFn: () => api.get<AdminStats>('/admin/stats'), refetchInterval: 60_000, enabled });

export default function AdminDashboard() {
  useTitle('Admin');
  const { data, isLoading } = useAdminStats();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  if (isLoading || !data) return <Spinner />;

  const todo = [
    data.pendingPayments > 0 && { to: '/admin/payments', icon: Banknote, text: `${data.pendingPayments} payment${data.pendingPayments > 1 ? 's' : ''} waiting for confirmation` },
    data.networkTodo > 0 && { to: '/admin/network?todo=1', icon: Router, text: `${data.networkTodo} Wi-Fi account${data.networkTodo > 1 ? 's' : ''} to switch on/off at the router` },
    data.openTickets > 0 && { to: '/admin/support', icon: LifeBuoy, text: `${data.openTickets} open support request${data.openTickets > 1 ? 's' : ''}` },
    data.customers.EXPIRING > 0 && { to: '/admin/customers?status=EXPIRING', icon: Clock, text: `${data.customers.EXPIRING} subscription${data.customers.EXPIRING > 1 ? 's' : ''} expiring within 7 days` },
  ].filter(Boolean) as { to: string; icon: typeof Clock; text: string }[];

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Subscribers, revenue and things that need your attention."
        actions={
          <Button
            variant="secondary"
            size="sm"
            loading={running}
            onClick={async () => {
              setRunning(true);
              await api.post('/admin/jobs/run').finally(() => setRunning(false));
              qc.invalidateQueries();
            }}
            title="Expiry checks run automatically every 10 minutes"
          >
            <RefreshCw className="h-4 w-4" /> Run expiry check
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Active subscribers" value={data.activeSubscribers} hint={`of ${data.customers.total} customers`} icon={<CircleCheck className="h-5 w-5" />} tone="green" />
        <Stat label="Expiring soon" value={data.customers.EXPIRING} hint="within 7 days" icon={<Clock className="h-5 w-5" />} tone="amber" />
        <Stat label="Expired" value={data.customers.EXPIRED} hint={`${data.customers.SUSPENDED} suspended`} icon={<XCircle className="h-5 w-5" />} tone="red" />
        <Stat label="Revenue this month" value={naira(data.revenueThisMonthKobo)} hint={`${data.unpaidInvoices} unpaid invoice${data.unpaidInvoices === 1 ? '' : 's'}`} icon={<Banknote className="h-5 w-5" />} tone="brand" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Monthly revenue" subtitle="Confirmed payments, last 6 months" />
          <div className="p-5">
            <RevenueChart data={data.revenueByMonth} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Needs attention" />
          {todo.length === 0 ? (
            <Empty icon={<CircleCheck className="h-10 w-10" />} title="All clear" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {todo.map((t) => (
                <li key={t.to}>
                  <Link to={t.to} className="flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-slate-50">
                    <span className="rounded-lg bg-amber-100 p-2 text-amber-700">
                      <t.icon className="h-4 w-4" />
                    </span>
                    <span className="font-medium text-slate-700">{t.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-px border-t border-slate-100 bg-slate-100">
            <div className="bg-white px-5 py-4">
              <p className="flex items-center gap-1.5 text-xs text-slate-500"><Building2 className="h-3.5 w-3.5" /> Offices connected</p>
              <p className="mt-1 text-xl font-bold">{data.officesConnected}</p>
            </div>
            <div className="bg-white px-5 py-4">
              <p className="flex items-center gap-1.5 text-xs text-slate-500"><Users className="h-3.5 w-3.5" /> Never subscribed</p>
              <p className="mt-1 text-xl font-bold">{data.customers.NO_SUBSCRIPTION}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Recent payments" action={<Link to="/admin/payments?status=" className="text-sm font-semibold text-brand-700">View all</Link>} />
        {data.recentPayments.length === 0 ? (
          <Empty icon={<AlertTriangle className="h-10 w-10" />} title="No payments yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.recentPayments.map((p) => (
              <li key={p.id}>
                <Link to={`/admin/customers/${p.customer!.id}`} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{p.customer!.companyName}</p>
                    <p className="text-xs text-slate-500">{p.planName} · {p.invoiceNo} · {timeAgo(p.createdAt)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-semibold">{naira(p.amountKobo)}</span>
                    <StatusBadge status={p.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
