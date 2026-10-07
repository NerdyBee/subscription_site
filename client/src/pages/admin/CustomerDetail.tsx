import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, CalendarPlus, CircleCheck, KeyRound, Pencil, Repeat, Wallet } from 'lucide-react';
import { Alert, Button, Card, CardHeader, CopyButton, cx, DefinitionList, Empty, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Td, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { fmtDate, fmtDateTime, humanize, naira } from '../../lib/format';
import { useTitle } from '../../lib/site';
import type { Invoice, Overview, Payment, Plan, Subscription, Ticket } from '../../lib/types';
import { useOffices } from './Customers';
import { ProofLink } from './Payments';

type Detail = Overview & {
  lastLoginAt: string | null;
  subscriptions: Subscription[];
  invoices: Invoice[];
  payments: Payment[];
  tickets: Ticket[];
};

export const useAdminPlans = () => useQuery({ queryKey: ['admin-plans'], queryFn: () => api.get<Plan[]>('/admin/plans') });

type Action = 'record' | 'extend' | 'plan' | 'edit' | 'suspend' | null;

export default function CustomerDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const key = ['admin-customer', id];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api.get<Detail>(`/admin/customers/${id}`) });
  const [action, setAction] = useState<Action>(null);
  const [tab, setTab] = useState<'subs' | 'invoices' | 'payments' | 'tickets'>('subs');
  const [notice, setNotice] = useState<ReactNode>(null);
  useTitle(data?.customer.companyName);
  if (isLoading || !data) return <Spinner />;

  const c = data.customer;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['admin-stats'] });
    qc.invalidateQueries({ queryKey: ['admin-customers'] });
  };
  const done = (msg: ReactNode) => {
    setAction(null);
    setNotice(msg);
    refresh();
  };

  async function resetPassword() {
    if (!confirm(`Reset the portal password for ${c.companyName}? They will be signed out everywhere.`)) return;
    const { tempPassword } = await api.post<{ tempPassword: string }>(`/admin/customers/${id}/reset-password`);
    setNotice(
      <span className="flex flex-wrap items-center gap-2">
        New portal password for {c.email}: <b className="font-mono">{tempPassword}</b> <CopyButton value={tempPassword} />
      </span>,
    );
  }

  async function reactivate() {
    await api.post(`/admin/customers/${id}/reactivate`);
    done('Customer reactivated.');
  }

  return (
    <>
      <Link to="/admin/customers" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Customers
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {c.companyName} <StatusBadge status={data.serviceStatus} />
          </span>
        }
        subtitle={`${c.accountNo} · ${c.office?.unit ?? 'No office'} · joined ${fmtDate(c.createdAt)}`}
        actions={
          <>
            <Button onClick={() => setAction('record')}>
              <Wallet className="h-4 w-4" /> Record payment
            </Button>
            <Button variant="secondary" onClick={() => setAction('extend')}>
              <CalendarPlus className="h-4 w-4" /> Add days
            </Button>
          </>
        }
      />
      {notice && (
        <Alert tone="success" className="mb-6">
          {notice}
        </Alert>
      )}
      {data.openInvoice && (
        <Alert tone={data.openInvoice.status === 'PENDING_VERIFICATION' ? 'warning' : 'info'} className="mb-6">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Open invoice <b>{data.openInvoice.number}</b> — {data.openInvoice.plan.name}, {naira(data.openInvoice.amountKobo)} ·{' '}
              {data.openInvoice.status === 'PENDING_VERIFICATION' ? 'customer says they paid' : 'awaiting payment'}
            </span>
            {data.openInvoice.status === 'PENDING_VERIFICATION' ? (
              <Link to="/admin/payments" className="font-semibold underline">
                Review payment
              </Link>
            ) : (
              <button className="font-semibold underline" onClick={() => setAction('record')}>
                Mark as paid
              </button>
            )}
          </span>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Subscription" />
          <div className="px-5 py-2">
            <DefinitionList
              items={[
                ['Current plan', data.current?.plan.name ?? '—'],
                ['Started', fmtDate(data.current?.startsAt)],
                ['Paid up until', fmtDate(data.coverageEnd)],
                ['Days remaining', data.daysRemaining],
                ['Queued renewals', data.upcoming.length],
              ]}
            />
          </div>
          <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-4">
            <Button size="sm" variant="secondary" onClick={() => setAction('plan')} disabled={!data.current}>
              <Repeat className="h-3.5 w-3.5" /> Change plan
            </Button>
            {c.status === 'ACTIVE' ? (
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setAction('suspend')}>
                <Ban className="h-3.5 w-3.5" /> Suspend
              </Button>
            ) : (
              <Button size="sm" variant="success" onClick={reactivate}>
                <CircleCheck className="h-3.5 w-3.5" /> Reactivate
              </Button>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Contact"
            action={
              <button onClick={() => setAction('edit')} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Edit">
                <Pencil className="h-4 w-4" />
              </button>
            }
          />
          <div className="px-5 py-2">
            <DefinitionList
              items={[
                ['Contact', c.contactName],
                ['Phone', <a href={`tel:${c.phone}`} className="text-brand-700">{c.phone}</a>],
                ['WhatsApp', c.whatsapp ?? '—'],
                ['Email', <span className="break-all">{c.email}</span>],
                ['Last login', fmtDateTime(data.lastLoginAt)],
              ]}
            />
          </div>
          {c.notes && <p className="border-t border-slate-100 px-5 py-3 text-sm whitespace-pre-wrap text-slate-600">{c.notes}</p>}
          <div className="border-t border-slate-100 px-5 py-3">
            <Button size="sm" variant="ghost" onClick={resetPassword}>
              <KeyRound className="h-3.5 w-3.5" /> Reset portal password
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Wi-Fi access" action={<Link to="/admin/network" className="text-sm font-semibold text-brand-700">Manage</Link>} />
          <div className="px-5 py-2">
            {data.network ? (
              <DefinitionList
                items={[
                  ['Username', <span className="font-mono">{data.network.username}</span>],
                  ['Password', <span className="font-mono">{data.network.password}</span>],
                  ['Should be', data.network.desiredEnabled ? <span className="text-emerald-700">ON</span> : <span className="text-slate-500">OFF</span>],
                  [
                    'Router (confirmed)',
                    <span className={cx(data.network.enabled !== data.network.desiredEnabled && 'text-amber-700')}>
                      {data.network.enabled ? 'ON' : 'OFF'}
                      {data.network.enabled !== data.network.desiredEnabled && ' — action needed'}
                    </span>,
                  ],
                ]}
              />
            ) : (
              <p className="py-4 text-sm text-slate-500">Created automatically on first payment.</p>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3">
          {(
            [
              ['subs', `Subscriptions (${data.subscriptions.length})`],
              ['invoices', `Invoices (${data.invoices.length})`],
              ['payments', `Payments (${data.payments.length})`],
              ['tickets', `Support (${data.tickets.length})`],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cx(
                '-mb-px border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap',
                tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              {l}
            </button>
          ))}
        </div>
        {tab === 'subs' &&
          (data.subscriptions.length ? (
            <Table head={['Plan', 'Starts', 'Expires', 'Source', 'Status', '']}>
              {data.subscriptions.map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium">{s.plan.name}</Td>
                  <Td>{fmtDate(s.startsAt)}</Td>
                  <Td>{fmtDate(s.expiresAt)}</Td>
                  <Td>{s.invoiceId ? 'Payment' : 'Complimentary'}</Td>
                  <Td>
                    <StatusBadge status={s.status === 'ACTIVE' && new Date(s.startsAt) > new Date() ? 'PENDING' : s.status} />
                  </Td>
                  <Td className="text-right">
                    {s.status === 'ACTIVE' && (
                      <button
                        className="text-xs font-medium text-red-600"
                        onClick={async () => {
                          if (!confirm('Cancel this subscription period? Access will be recalculated immediately.')) return;
                          await api.post(`/admin/customers/${id}/subscriptions/${s.id}/cancel`);
                          done('Subscription cancelled.');
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="No subscriptions yet" />
          ))}
        {tab === 'invoices' &&
          (data.invoices.length ? (
            <Table head={['Invoice', 'Plan', 'Created', 'Amount', 'Status']}>
              {data.invoices.map((i) => (
                <tr key={i.id}>
                  <Td className="font-mono">{i.number}</Td>
                  <Td>{i.plan.name}</Td>
                  <Td>{fmtDate(i.createdAt)}</Td>
                  <Td className="font-semibold">{naira(i.amountKobo)}</Td>
                  <Td>
                    <StatusBadge status={i.status} />
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="No invoices" />
          ))}
        {tab === 'payments' &&
          (data.payments.length ? (
            <Table head={['Date', 'Invoice', 'Amount', 'Method', 'Details', 'Status']}>
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <Td>{fmtDateTime(p.createdAt)}</Td>
                  <Td className="font-mono">{p.invoiceNo}</Td>
                  <Td className="font-semibold">{naira(p.amountKobo)}</Td>
                  <Td>{humanize(p.method)}</Td>
                  <Td className="text-xs text-slate-500">
                    {[p.senderName, p.senderBank, p.transferRef].filter(Boolean).join(' · ') || p.note || '—'}
                    {p.hasProof && (
                      <span className="ml-2">
                        <ProofLink paymentId={p.id} />
                      </span>
                    )}
                  </Td>
                  <Td>
                    <StatusBadge status={p.status} />
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="No payments" />
          ))}
        {tab === 'tickets' &&
          (data.tickets.length ? (
            <ul className="divide-y divide-slate-100">
              {data.tickets.map((t) => (
                <li key={t.id}>
                  <Link to={`/admin/support/${t.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50">
                    <span className="text-sm font-medium">
                      {t.subject} <span className="text-xs text-slate-500">· {t.number}</span>
                    </span>
                    <StatusBadge status={t.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No support requests" />
          ))}
      </Card>

      <RecordPaymentModal open={action === 'record'} onClose={() => setAction(null)} detail={data} onDone={done} />
      <ExtendModal open={action === 'extend'} onClose={() => setAction(null)} detail={data} onDone={done} />
      <ChangePlanModal open={action === 'plan'} onClose={() => setAction(null)} detail={data} onDone={done} />
      <EditModal open={action === 'edit'} onClose={() => setAction(null)} detail={data} onDone={done} />
      <SuspendModal open={action === 'suspend'} onClose={() => setAction(null)} detail={data} onDone={done} />
    </>
  );
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  detail: Detail;
  onDone: (msg: ReactNode) => void;
}

/** Shared submit plumbing for the action modals. */
function useSubmit(fn: (form: Record<string, string>) => Promise<ReactNode>, onDone: (msg: ReactNode) => void) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      onDone(await fn(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return { error, loading, submit };
}

function RecordPaymentModal({ open, onClose, detail, onDone }: ModalProps) {
  const { data: plans } = useAdminPlans();
  const open_ = detail.openInvoice;
  const [planId, setPlanId] = useState('');
  const [useOpen, setUseOpen] = useState(true);
  const usingInvoice = !!open_ && useOpen;
  const plan = plans?.find((p) => p.id === (planId || detail.current?.plan.id || detail.lastPlan?.id));
  const { error, loading, submit } = useSubmit(async (f) => {
    const res = await api.post<{ expiresAt: string }>(`/admin/customers/${detail.customer.id}/record-payment`, {
      method: f.method,
      transferRef: f.transferRef || undefined,
      note: f.note || undefined,
      ...(usingInvoice ? { invoiceId: open_!.id } : { planId: f.planId, amount: f.amount }),
    });
    return `Payment recorded. Subscription runs until ${fmtDate(res.expiresAt)}.`;
  }, onDone);

  return (
    <Modal open={open} onClose={onClose} title="Record payment">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <p className="text-sm text-slate-600">Use this for cash, POS, or a transfer the customer didn’t submit through the portal. The subscription is activated immediately.</p>
        {open_ && (
          <label className="flex items-start gap-3 rounded-lg p-3 ring-1 ring-slate-200">
            <input type="checkbox" checked={useOpen} onChange={(e) => setUseOpen(e.target.checked)} className="mt-1" />
            <span className="text-sm">
              Pay open invoice <b>{open_.number}</b> — {open_.plan.name}, {naira(open_.amountKobo)}
            </span>
          </label>
        )}
        {!usingInvoice && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Package">
              <Select name="planId" required value={plan?.id ?? ''} onChange={(e) => setPlanId(e.target.value)}>
                <option value="" disabled>
                  Choose…
                </option>
                {plans?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {naira(p.priceKobo)}
                    {!p.isActive ? ' (hidden)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount received (₦)">
              <Input name="amount" type="number" min={0} step="0.01" key={plan?.id} defaultValue={plan ? plan.priceKobo / 100 : ''} required />
            </Field>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Method">
            <Select name="method" defaultValue="BANK_TRANSFER">
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="CASH">Cash</option>
              <option value="POS">POS</option>
              <option value="OTHER">Other</option>
            </Select>
          </Field>
          <Field label="Reference (optional)">
            <Input name="transferRef" />
          </Field>
        </div>
        <Field label="Note (optional)">
          <Textarea name="note" rows={2} />
        </Field>
        <Button type="submit" className="w-full" loading={loading}>
          Record payment & activate
        </Button>
      </form>
    </Modal>
  );
}

function ExtendModal({ open, onClose, detail, onDone }: ModalProps) {
  const { data: plans } = useAdminPlans();
  const needsPlan = !detail.coverageEnd && !detail.lastPlan;
  const { error, loading, submit } = useSubmit(async (f) => {
    const res = await api.post<{ expiresAt: string }>(`/admin/customers/${detail.customer.id}/extend`, {
      days: Number(f.days),
      reason: f.reason,
      planId: f.planId || undefined,
    });
    return `Added ${f.days} day(s). Now paid up until ${fmtDate(res.expiresAt)}.`;
  }, onDone);
  return (
    <Modal open={open} onClose={onClose} title="Add free days">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <p className="text-sm text-slate-600">
          {detail.coverageEnd
            ? `Extends the current subscription (ends ${fmtDate(detail.coverageEnd)}).`
            : 'Starts a complimentary subscription from today.'}
        </p>
        <Field label="Number of days">
          <Input name="days" type="number" min={1} max={366} defaultValue={1} required />
        </Field>
        {needsPlan && (
          <Field label="Package">
            <Select name="planId" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {plans?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Reason" hint="Shown to the customer">
          <Input name="reason" required placeholder="e.g. Compensation for outage on 12 Oct" />
        </Field>
        <Button type="submit" className="w-full" loading={loading}>
          Add days
        </Button>
      </form>
    </Modal>
  );
}

function ChangePlanModal({ open, onClose, detail, onDone }: ModalProps) {
  const { data: plans } = useAdminPlans();
  const { error, loading, submit } = useSubmit(async (f) => {
    await api.post(`/admin/customers/${detail.customer.id}/change-plan`, { planId: f.planId });
    return 'Plan changed for the current period.';
  }, onDone);
  return (
    <Modal open={open} onClose={onClose} title="Change current plan">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <p className="text-sm text-slate-600">
          Switches the running subscription to another package right away, keeping the same expiry date. Any price difference should be
          collected with “Record payment” or settled separately.
        </p>
        <Field label="New package">
          <Select name="planId" required defaultValue={detail.current?.plan.id}>
            {plans?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.speed}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" className="w-full" loading={loading}>
          Change plan
        </Button>
      </form>
    </Modal>
  );
}

function EditModal({ open, onClose, detail, onDone }: ModalProps) {
  const { data: offices } = useOffices();
  const c = detail.customer;
  const { error, loading, submit } = useSubmit(async (f) => {
    await api.patch(`/admin/customers/${c.id}`, f);
    return 'Customer details saved.';
  }, onDone);
  return (
    <Modal open={open} onClose={onClose} title="Edit customer">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Company name">
          <Input name="companyName" defaultValue={c.companyName} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact name">
            <Input name="contactName" defaultValue={c.contactName} required />
          </Field>
          <Field label="Phone">
            <Input name="phone" defaultValue={c.phone} required />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="WhatsApp">
            <Input name="whatsapp" defaultValue={c.whatsapp ?? ''} />
          </Field>
          <Field label="Office">
            <Select name="officeId" defaultValue={c.office?.id ?? ''}>
              <option value="">— None —</option>
              {offices?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.unit}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Internal notes">
          <Textarea name="notes" defaultValue={c.notes ?? ''} rows={3} />
        </Field>
        <Button type="submit" className="w-full" loading={loading}>
          Save
        </Button>
      </form>
    </Modal>
  );
}

function SuspendModal({ open, onClose, detail, onDone }: ModalProps) {
  const { error, loading, submit } = useSubmit(async (f) => {
    await api.post(`/admin/customers/${detail.customer.id}/suspend`, { reason: f.reason || undefined });
    return 'Customer suspended. Turn their Wi-Fi off at the router (see Network).';
  }, onDone);
  return (
    <Modal open={open} onClose={onClose} title="Suspend customer">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <p className="text-sm text-slate-600">
          Suspending cuts internet access even if they have paid time left. Their paid days keep counting down.
        </p>
        <Field label="Reason (shown to customer)">
          <Input name="reason" placeholder="e.g. Policy violation" />
        </Field>
        <Button type="submit" variant="danger" className="w-full" loading={loading}>
          Suspend service
        </Button>
      </form>
    </Modal>
  );
}
