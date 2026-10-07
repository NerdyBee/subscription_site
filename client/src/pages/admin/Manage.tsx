import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LifeBuoy, Plus, Trash2 } from 'lucide-react';
import { TicketThread } from '../../components/TicketThread';
import { Alert, Badge, Button, Card, CardHeader, CopyButton, cx, Empty, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Td, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDateTime, timeAgo } from '../../lib/format';
import { useTitle } from '../../lib/site';
import type { BankAccount, SiteSettings, Ticket, TicketDetail, TicketStatus } from '../../lib/types';

// ---- Support ---------------------------------------------------------------------------

export function AdminSupport() {
  useTitle('Support');
  const [status, setStatus] = useState<'' | TicketStatus>('OPEN');
  const { data, isLoading } = useQuery({
    queryKey: ['admin-tickets', status],
    queryFn: () => api.get<Ticket[]>(`/admin/tickets?status=${status}`),
  });
  return (
    <>
      <PageHeader title="Support requests" />
      <div className="mb-4 inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {(
          [
            ['OPEN', 'Open'],
            ['IN_PROGRESS', 'In progress'],
            ['RESOLVED', 'Resolved'],
            ['CLOSED', 'Closed'],
            ['', 'All'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setStatus(k)} className={cx('rounded-md px-3 py-1.5 text-sm font-medium', status === k ? 'bg-white shadow-sm' : 'text-slate-600')}>
            {l}
          </button>
        ))}
      </div>
      <Card>
        {isLoading ? (
          <Spinner />
        ) : !data?.length ? (
          <Empty icon={<LifeBuoy className="h-10 w-10" />} title="No requests here" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((t) => (
              <li key={t.id}>
                <Link to={`/admin/support/${t.id}`} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{t.subject}</p>
                    <p className="text-xs text-slate-500">
                      {t.customer?.companyName} · {t.number} · updated {timeAgo(t.updatedAt)}
                    </p>
                  </div>
                  <StatusBadge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export function AdminTicket() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin-ticket', id], queryFn: () => api.get<TicketDetail>(`/admin/tickets/${id}`) });
  useTitle(data?.subject);
  if (isLoading || !data) return <Spinner />;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-ticket', id] });
    qc.invalidateQueries({ queryKey: ['admin-tickets'] });
    qc.invalidateQueries({ queryKey: ['admin-stats'] });
  };
  const setStatus = async (status: TicketStatus) => {
    await api.patch(`/admin/tickets/${id}`, { status });
    refresh();
  };
  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/admin/support" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Support
      </Link>
      <PageHeader
        title={data.subject}
        subtitle={
          <>
            <Link to={`/admin/customers/${data.customer?.id}`} className="font-medium text-brand-700">
              {data.customer?.companyName}
            </Link>{' '}
            · {data.number} · opened {fmtDateTime(data.createdAt)}
          </>
        }
        actions={
          <Select value={data.status} onChange={(e) => setStatus(e.target.value as TicketStatus)} className="w-40">
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
          </Select>
        }
      />
      <TicketThread
        ticket={data}
        viewer="staff"
        onReply={async (body) => {
          await api.post(`/admin/tickets/${id}/messages`, { body });
          refresh();
        }}
        extraActions={
          data.status !== 'RESOLVED' && (
            <Button size="sm" variant="ghost" type="button" onClick={() => setStatus('RESOLVED')}>
              Mark resolved
            </Button>
          )
        }
      />
    </div>
  );
}

// ---- Settings --------------------------------------------------------------------------

export function Settings() {
  useTitle('Settings');
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = user?.role === 'SUPER_ADMIN';
  const { data } = useQuery({ queryKey: ['admin-settings'], queryFn: () => api.get<SiteSettings>('/admin/settings') });
  const [form, setForm] = useState<SiteSettings | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);
  if (!form) return <Spinner />;

  const set = <K extends keyof SiteSettings>(k: K, v: SiteSettings[K]) => setForm({ ...form, [k]: v });
  const setBank = (i: number, k: keyof BankAccount, v: string) =>
    set('bankAccounts', form.bankAccounts.map((b, j) => (j === i ? { ...b, [k]: v } : b)));

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await api.put('/admin/settings', form);
      qc.invalidateQueries({ queryKey: ['site'] });
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
      setMsg({ tone: 'success', text: 'Settings saved.' });
    } catch (err) {
      setMsg({ tone: 'error', text: errorMessage(err) });
    } finally {
      setSaving(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  const text = (k: keyof SiteSettings, label: string, hint?: string, placeholder?: string) => (
    <Field label={label} hint={hint}>
      <Input value={form[k] as string} onChange={(e) => set(k, e.target.value as never)} disabled={!canEdit} placeholder={placeholder} />
    </Field>
  );

  return (
    <form onSubmit={save}>
      <PageHeader
        title="Settings"
        subtitle={canEdit ? 'Branding, contact details and payment accounts.' : 'Only a super admin can change settings.'}
        actions={canEdit && <Button type="submit" loading={saving}>Save settings</Button>}
      />
      {msg && <Alert tone={msg.tone} className="mb-6">{msg.text}</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Branding" />
          <div className="space-y-4 p-5">
            {text('brandName', 'Service name')}
            {text('tagline', 'Tagline')}
            {text('complexName', 'Complex / building name', undefined, 'e.g. Victoria Plaza')}
            {text('address', 'Address')}
            {text('poweredBy', 'Attribution line', 'Keep it factual, e.g. “Internet connectivity powered by Starlink”')}
          </div>
        </Card>
        <Card>
          <CardHeader title="Contact" />
          <div className="space-y-4 p-5">
            {text('supportPhone', 'Support phone')}
            {text('supportEmail', 'Support email')}
            {text('whatsappNumber', 'WhatsApp number', 'International format without +, e.g. 2348012345678. Leave empty to hide the WhatsApp button.')}
            <Field label="Expiry reminders (days before)" hint="Comma separated, e.g. 7, 3, 1">
              <Input
                value={form.reminderDays.join(', ')}
                disabled={!canEdit}
                onChange={(e) =>
                  set(
                    'reminderDays',
                    e.target.value
                      .split(',')
                      .map((s) => parseInt(s.trim(), 10))
                      .filter((n) => !Number.isNaN(n)),
                  )
                }
              />
            </Field>
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader
            title="Bank accounts for payment"
            subtitle="Shown to customers on the payment page."
            action={
              canEdit && (
                <Button type="button" size="sm" variant="secondary" onClick={() => set('bankAccounts', [...form.bankAccounts, { bankName: '', accountName: '', accountNumber: '' }])}>
                  <Plus className="h-4 w-4" /> Add account
                </Button>
              )
            }
          />
          <div className="space-y-4 p-5">
            {form.bankAccounts.length === 0 && <Alert tone="warning">Add at least one bank account so customers can pay.</Alert>}
            {form.bankAccounts.map((b, i) => (
              <div key={i} className="grid items-end gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <Field label="Bank">
                  <Input value={b.bankName} onChange={(e) => setBank(i, 'bankName', e.target.value)} required disabled={!canEdit} placeholder="e.g. Moniepoint" />
                </Field>
                <Field label="Account number">
                  <Input value={b.accountNumber} onChange={(e) => setBank(i, 'accountNumber', e.target.value.replace(/\D/g, '').slice(0, 10))} required disabled={!canEdit} inputMode="numeric" className="font-mono" />
                </Field>
                <Field label="Account name">
                  <Input value={b.accountName} onChange={(e) => setBank(i, 'accountName', e.target.value)} required disabled={!canEdit} />
                </Field>
                {canEdit && (
                  <button type="button" onClick={() => set('bankAccounts', form.bankAccounts.filter((_, j) => j !== i))} className="mb-1 rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            <Field label="Payment instructions">
              <Textarea value={form.paymentInstructions} onChange={(e) => set('paymentInstructions', e.target.value)} rows={3} disabled={!canEdit} />
            </Field>
          </div>
        </Card>
      </div>
    </form>
  );
}

// ---- Staff -----------------------------------------------------------------------------

interface Staff {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'SUPER_ADMIN';
  isActive: boolean;
  lastLoginAt: string | null;
}

export function StaffPage() {
  useTitle('Staff');
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['staff'], queryFn: () => api.get<Staff[]>('/admin/staff') });
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<{ email: string; tempPassword: string } | null>(null);
  const [error, setError] = useState('');

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      const res = await api.post<{ tempPassword: string }>('/admin/staff', body);
      setCreated({ email: body.email, tempPassword: res.tempPassword });
      qc.invalidateQueries({ queryKey: ['staff'] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="People who can log in to this admin portal."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add staff
          </Button>
        }
      />
      <Card>
        {isLoading ? (
          <Spinner />
        ) : (
          <Table head={['Name', 'Role', 'Last login', 'Status', '']}>
            {data?.map((s) => (
              <tr key={s.id}>
                <Td>
                  <span className="font-medium">{s.name}</span>
                  <span className="block text-xs text-slate-500">{s.email}</span>
                </Td>
                <Td>{s.role === 'SUPER_ADMIN' ? <Badge tone="blue">Super admin</Badge> : <Badge>Admin</Badge>}</Td>
                <Td>{fmtDateTime(s.lastLoginAt)}</Td>
                <Td>{s.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Disabled</Badge>}</Td>
                <Td className="text-right">
                  {s.id !== user?.id && (
                    <button
                      className="text-xs font-medium text-brand-700"
                      onClick={async () => {
                        await api.patch(`/admin/staff/${s.id}`, { isActive: !s.isActive });
                        qc.invalidateQueries({ queryKey: ['staff'] });
                      }}
                    >
                      {s.isActive ? 'Disable' : 'Enable'}
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal
        open={adding}
        onClose={() => {
          setAdding(false);
          setCreated(null);
          setError('');
        }}
        title={created ? 'Staff member added' : 'Add staff'}
      >
        {created ? (
          <div className="space-y-3">
            <Alert tone="success">Share these login details. They should change the password after first login.</Alert>
            <div className="space-y-2 rounded-lg bg-slate-50 p-4 font-mono text-sm">
              <p>Email: {created.email}</p>
              <p className="flex items-center justify-between">
                Password: {created.tempPassword} <CopyButton value={created.tempPassword} />
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={add} className="space-y-4">
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="Name">
              <Input name="name" required />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" required />
            </Field>
            <Field label="Role" hint="Super admins can also change settings and manage staff.">
              <Select name="role" defaultValue="ADMIN">
                <option value="ADMIN">Admin / operator</option>
                <option value="SUPER_ADMIN">Super admin</option>
              </Select>
            </Field>
            <Button type="submit" className="w-full">
              Add staff member
            </Button>
          </form>
        )}
      </Modal>
    </>
  );
}

// ---- Audit log -------------------------------------------------------------------------

interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  actor: { name: string; email: string; role: string } | null;
}

export function AuditLog() {
  useTitle('Activity log');
  const { data, isLoading } = useQuery({ queryKey: ['audit'], queryFn: () => api.get<AuditEntry[]>('/admin/audit') });
  return (
    <>
      <PageHeader title="Activity log" subtitle="The last 200 actions taken in the system." />
      <Card>
        {isLoading ? (
          <Spinner />
        ) : (
          <Table head={['When', 'Who', 'Action', 'Details']}>
            {data?.map((a) => (
              <tr key={a.id}>
                <Td className="text-xs">{fmtDateTime(a.createdAt)}</Td>
                <Td>
                  {a.actor?.name ?? 'System'}
                  {a.actor?.role === 'CUSTOMER' && <span className="ml-1 text-xs text-slate-400">(customer)</span>}
                </Td>
                <Td className="font-mono text-xs">{a.action}</Td>
                <Td className="max-w-md truncate text-xs text-slate-500">{a.meta ? JSON.stringify(a.meta) : ''}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

export function ChangeOwnPassword() {
  useTitle('My password');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (f.newPassword !== f.confirm) return setMsg({ tone: 'error', text: 'New passwords do not match' });
    try {
      await api.post('/auth/change-password', { currentPassword: f.currentPassword, newPassword: f.newPassword });
      form.reset();
      setMsg({ tone: 'success', text: 'Password changed' });
    } catch (err) {
      setMsg({ tone: 'error', text: errorMessage(err) });
    }
  }
  return (
    <>
      <PageHeader title="My password" />
      <Card className="max-w-md">
        <form onSubmit={submit} className="space-y-4 p-5">
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <Field label="Current password">
            <Input name="currentPassword" type="password" required />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <Input name="newPassword" type="password" required minLength={8} />
          </Field>
          <Field label="Confirm new password">
            <Input name="confirm" type="password" required minLength={8} />
          </Field>
          <Button type="submit">Change password</Button>
        </form>
      </Card>
    </>
  );
}
