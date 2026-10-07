import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, Building2, Clock, Eye, EyeOff, KeyRound, RefreshCw, Wifi } from 'lucide-react';
import { Alert, Card, CardHeader, CopyButton, cx, DefinitionList, Empty, Spinner, StatusBadge } from '../../components/ui';
import { api } from '../../lib/api';
import { fmtDate, greeting, naira, per } from '../../lib/format';
import { useTitle } from '../../lib/site';
import type { Overview } from '../../lib/types';

export const useOverview = () => useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/me/overview') });

export default function Dashboard() {
  useTitle('Dashboard');
  const { data, isLoading } = useOverview();
  const [showPw, setShowPw] = useState(false);
  if (isLoading || !data) return <Spinner />;

  const { customer, current, serviceStatus, daysRemaining, coverageEnd, network, openInvoice } = data;
  const plan = current?.plan ?? data.lastPlan;
  const total = current ? Math.max(1, Math.round((+new Date(current.expiresAt) - +new Date(current.startsAt)) / 86_400_000)) : 1;
  const pct = current ? Math.min(100, Math.round((Math.min(daysRemaining, total) / total) * 100)) : 0;
  const expiringSoon = serviceStatus === 'ACTIVE' && daysRemaining <= 3;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">{greeting()},</p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{customer.companyName}</h1>
      </div>

      {openInvoice?.status === 'PENDING_VERIFICATION' && (
        <Alert tone="info">
          We’re confirming your payment for <b>{openInvoice.plan.name}</b> ({openInvoice.number}). You’ll be notified as soon as it’s
          approved.
        </Alert>
      )}
      {openInvoice?.status === 'UNPAID' && (
        <Alert tone="warning">
          Invoice {openInvoice.number} for <b>{openInvoice.plan.name}</b> ({naira(openInvoice.amountKobo)}) is awaiting payment.{' '}
          <Link to={`/account/invoices/${openInvoice.id}`} className="font-semibold underline">
            Pay now
          </Link>
        </Alert>
      )}
      {serviceStatus === 'SUSPENDED' && (
        <Alert tone="error">Your account is suspended. Please contact support to restore service.</Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Status card */}
        <Card className="overflow-hidden lg:col-span-2">
          <div
            className={cx(
              'flex items-center justify-between px-6 py-5',
              serviceStatus === 'ACTIVE' ? (expiringSoon ? 'bg-amber-50' : 'bg-emerald-50') : 'bg-slate-50',
            )}
          >
            <div className="flex items-center gap-3">
              <div
                className={cx(
                  'rounded-full p-2.5',
                  serviceStatus === 'ACTIVE' ? 'bg-emerald-500 text-white' : 'bg-slate-300 text-white',
                )}
              >
                <Wifi className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Internet status</p>
                <p className="font-semibold text-slate-900">
                  {serviceStatus === 'ACTIVE' ? 'Your subscription is active' : serviceStatus === 'EXPIRED' ? 'Your subscription has expired' : serviceStatus === 'SUSPENDED' ? 'Service suspended' : 'No active subscription'}
                </p>
              </div>
            </div>
            <StatusBadge status={serviceStatus} />
          </div>

          <div className="p-6">
            {plan ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-lg font-bold text-slate-900">{plan.name}</p>
                    <p className="text-sm text-slate-500">{plan.speed}</p>
                  </div>
                  <p className="text-sm text-slate-600">
                    <span className="text-lg font-bold text-slate-900">{naira(plan.priceKobo)}</span> / {per(plan.durationDays)}
                  </p>
                </div>

                {current && (
                  <div className="mt-6">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Activated</p>
                        <p className="mt-1 text-sm font-semibold">{fmtDate(current.startsAt)}</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Expires</p>
                        <p className="mt-1 text-sm font-semibold">{fmtDate(coverageEnd)}</p>
                      </div>
                      <div className={cx('rounded-lg p-3', expiringSoon ? 'bg-amber-50' : 'bg-slate-50')}>
                        <p className="text-xs text-slate-500">Remaining</p>
                        <p className={cx('mt-1 text-sm font-semibold', expiringSoon && 'text-amber-700')}>
                          {daysRemaining} day{daysRemaining === 1 ? '' : 's'}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={cx('h-full rounded-full', expiringSoon ? 'bg-amber-500' : 'bg-emerald-500')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {data.upcoming.length > 0 && (
                      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                        <Clock className="h-3.5 w-3.5" />
                        Renewal of {data.upcoming[0].plan.name} queued — starts {fmtDate(data.upcoming[0].startsAt)}
                      </p>
                    )}
                  </div>
                )}
                {!current && coverageEnd === null && serviceStatus === 'EXPIRED' && (
                  <p className="mt-4 flex items-center gap-2 text-sm text-red-700">
                    <AlertTriangle className="h-4 w-4" /> Renew to reconnect your office.
                  </p>
                )}
              </>
            ) : (
              <Empty icon={<Wifi className="h-10 w-10" />} title="You don’t have a subscription yet">
                Choose a package to get your office online.
              </Empty>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to={plan ? `/account/subscribe?plan=${plan.id}` : '/account/subscribe'}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
              >
                <RefreshCw className="h-4 w-4" />
                {plan ? 'Renew subscription' : 'Choose a package'}
              </Link>
              {plan && (
                <Link
                  to="/account/subscribe"
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
                >
                  <ArrowUpRight className="h-4 w-4" /> Change plan
                </Link>
              )}
            </div>
          </div>
        </Card>

        {/* Account card */}
        <div className="space-y-6">
          <Card>
            <CardHeader title="Account" />
            <div className="px-5 py-2">
              <DefinitionList
                items={[
                  ['Account ID', customer.accountNo],
                  ['Office', customer.office ? <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5 text-slate-400" />{customer.office.unit}</span> : '—'],
                  ['Contact', customer.contactName],
                  [
                    'Connection',
                    network?.enabled ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" />Online</span>
                    ) : network?.desiredEnabled ? (
                      <span className="text-amber-700">Being switched on…</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-slate-500"><span className="h-2 w-2 rounded-full bg-slate-400" />Offline</span>
                    ),
                  ],
                ]}
              />
            </div>
          </Card>
          {network && (
            <Card>
              <CardHeader title={<span className="inline-flex items-center gap-2"><KeyRound className="h-4 w-4 text-slate-400" />Wi-Fi login</span>} />
              <div className="space-y-3 px-5 py-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Username</span>
                  <span className="flex items-center gap-1 font-mono font-semibold">{network.username}<CopyButton value={network.username} label="" /></span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Password</span>
                  <span className="flex items-center gap-1 font-mono font-semibold">
                    {showPw ? network.password : '••••••••'}
                    <button onClick={() => setShowPw((s) => !s)} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Toggle password">
                      {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </span>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader
          title="Recent payments"
          action={
            <Link to="/account/billing" className="text-sm font-semibold text-brand-700">
              View all
            </Link>
          }
        />
        {data.recentPayments.length === 0 ? (
          <Empty title="No payments yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.recentPayments.map((p) => (
              <li key={p.id}>
                <Link to={`/account/invoices/${p.invoiceId}`} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-slate-50">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{p.planName}</p>
                    <p className="text-xs text-slate-500">{fmtDate(p.createdAt)} · {p.invoiceNo}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">{naira(p.amountKobo)}</span>
                    <StatusBadge status={p.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
