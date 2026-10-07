import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LifeBuoy, Plus, Receipt } from 'lucide-react';
import { TicketThread } from '../../components/TicketThread';
import { Alert, Button, Card, CardHeader, Empty, Field, Input, Modal, PageHeader, Spinner, StatusBadge, Table, Td, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { fmtDate, naira, timeAgo } from '../../lib/format';
import { useTitle } from '../../lib/site';
import type { Invoice, Ticket, TicketDetail } from '../../lib/types';
import { useOverview } from './Dashboard';

export function Billing() {
  useTitle('Billing');
  const { data, isLoading } = useQuery({ queryKey: ['my-invoices'], queryFn: () => api.get<Invoice[]>('/me/invoices') });
  return (
    <>
      <PageHeader
        title="Billing"
        subtitle="Your invoices, payments and receipts."
        actions={
          <Link to="/account/subscribe" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            Renew / buy package
          </Link>
        }
      />
      <Card>
        {isLoading ? (
          <Spinner />
        ) : !data?.length ? (
          <Empty icon={<Receipt className="h-10 w-10" />} title="No invoices yet" />
        ) : (
          <Table head={['Invoice', 'Package', 'Date', 'Amount', 'Status', '']}>
            {data.map((i) => (
              <tr key={i.id} className="hover:bg-slate-50">
                <Td className="font-mono font-medium">{i.number}</Td>
                <Td>{i.plan.name}</Td>
                <Td>{fmtDate(i.createdAt)}</Td>
                <Td className="font-semibold">{naira(i.amountKobo)}</Td>
                <Td>
                  <StatusBadge status={i.status} />
                </Td>
                <Td className="text-right">
                  <Link to={`/account/invoices/${i.id}`} className="text-sm font-semibold text-brand-700">
                    {i.status === 'PAID' ? 'Receipt' : i.status === 'UNPAID' ? 'Pay' : 'View'}
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

export function SupportList() {
  useTitle('Support');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['my-tickets'], queryFn: () => api.get<Ticket[]>('/me/tickets') });

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const t = await api.post<Ticket>('/me/tickets', Object.fromEntries(new FormData(e.currentTarget)));
      qc.invalidateQueries({ queryKey: ['my-tickets'] });
      navigate(`/account/support/${t.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Support"
        subtitle="Having trouble with your connection or billing? We’re here to help."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> New request
          </Button>
        }
      />
      <Card>
        {isLoading ? (
          <Spinner />
        ) : !data?.length ? (
          <Empty icon={<LifeBuoy className="h-10 w-10" />} title="No support requests">
            Open a request and we’ll get back to you.
          </Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((t) => (
              <li key={t.id}>
                <Link to={`/account/support/${t.id}`} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{t.subject}</p>
                    <p className="text-xs text-slate-500">
                      {t.number} · updated {timeAgo(t.updatedAt)}
                    </p>
                  </div>
                  <StatusBadge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="New support request">
        <form onSubmit={create} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Subject">
            <Input name="subject" required placeholder="e.g. Internet is slow since this morning" />
          </Field>
          <Field label="Describe the problem">
            <Textarea name="body" required rows={5} />
          </Field>
          <Button type="submit" className="w-full" loading={loading}>
            Submit request
          </Button>
        </form>
      </Modal>
    </>
  );
}

export function SupportTicketPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['my-ticket', id], queryFn: () => api.get<TicketDetail>(`/me/tickets/${id}`) });
  useTitle(data?.subject ?? 'Support');
  if (isLoading || !data) return <Spinner />;
  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/account/support" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Support
      </Link>
      <PageHeader title={data.subject} subtitle={`${data.number} · opened ${fmtDate(data.createdAt)}`} actions={<StatusBadge status={data.status} />} />
      <TicketThread
        ticket={data}
        viewer="customer"
        onReply={async (body) => {
          await api.post(`/me/tickets/${id}/messages`, { body });
          qc.invalidateQueries({ queryKey: ['my-ticket', id] });
          qc.invalidateQueries({ queryKey: ['my-tickets'] });
        }}
      />
    </div>
  );
}

export function Profile() {
  useTitle('Profile');
  const { data } = useOverview();
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [pwMsg, setPwMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  if (!data) return <Spinner />;
  const c = data.customer;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch('/me/profile', Object.fromEntries(new FormData(e.currentTarget)));
      qc.invalidateQueries({ queryKey: ['overview'] });
      setMsg({ tone: 'success', text: 'Profile updated' });
    } catch (err) {
      setMsg({ tone: 'error', text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (f.newPassword !== f.confirm) return setPwMsg({ tone: 'error', text: 'New passwords do not match' });
    try {
      await api.post('/auth/change-password', { currentPassword: f.currentPassword, newPassword: f.newPassword });
      form.reset();
      setPwMsg({ tone: 'success', text: 'Password changed' });
    } catch (err) {
      setPwMsg({ tone: 'error', text: errorMessage(err) });
    }
  }

  return (
    <>
      <PageHeader title="Profile" subtitle={`Account ${c.accountNo}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Contact details" subtitle="Company name and office can be changed by our team." />
          <form onSubmit={save} className="space-y-4 p-5">
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            <Field label="Company">
              <Input value={c.companyName} disabled />
            </Field>
            <Field label="Office">
              <Input value={c.office?.unit ?? '—'} disabled />
            </Field>
            <Field label="Email">
              <Input value={c.email ?? ''} disabled />
            </Field>
            <Field label="Contact name">
              <Input name="contactName" defaultValue={c.contactName} required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone">
                <Input name="phone" defaultValue={c.phone} required />
              </Field>
              <Field label="WhatsApp">
                <Input name="whatsapp" defaultValue={c.whatsapp ?? ''} />
              </Field>
            </div>
            <Button type="submit" loading={saving}>
              Save changes
            </Button>
          </form>
        </Card>
        <Card className="self-start">
          <CardHeader title="Change password" />
          <form onSubmit={changePassword} className="space-y-4 p-5">
            {pwMsg && <Alert tone={pwMsg.tone}>{pwMsg.text}</Alert>}
            <Field label="Current password">
              <Input name="currentPassword" type="password" required autoComplete="current-password" />
            </Field>
            <Field label="New password" hint="At least 8 characters">
              <Input name="newPassword" type="password" required minLength={8} autoComplete="new-password" />
            </Field>
            <Field label="Confirm new password">
              <Input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
            </Field>
            <Button type="submit">Change password</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
