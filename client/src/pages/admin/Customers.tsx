import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Users } from 'lucide-react';
import { Alert, Button, Card, CopyButton, cx, Empty, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Td, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useTitle } from '../../lib/site';
import type { Customer, ServiceStatus } from '../../lib/types';

type Row = Customer & {
  service: { status: ServiceStatus; planName: string | null; coverageEnd: string | null; daysRemaining: number };
  network: { enabled: boolean; desiredEnabled: boolean } | null;
};

export interface Office {
  id: string;
  unit: string;
  floor: string | null;
  block: string | null;
  notes: string | null;
  customers: { id: string; companyName: string; accountNo: string }[];
}

export const useOffices = () => useQuery({ queryKey: ['offices'], queryFn: () => api.get<Office[]>('/admin/offices') });

const tabs: { key: '' | ServiceStatus; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'EXPIRING', label: 'Expiring' },
  { key: 'EXPIRED', label: 'Expired' },
  { key: 'NO_SUBSCRIPTION', label: 'Not subscribed' },
  { key: 'SUSPENDED', label: 'Suspended' },
];

export default function Customers() {
  useTitle('Customers');
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['admin-customers', status, q],
    queryFn: () => api.get<Row[]>(`/admin/customers?status=${status}&q=${encodeURIComponent(q)}`),
    placeholderData: (prev) => prev,
  });

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Offices and companies using the service."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add customer
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setParams(t.key ? { status: t.key } : {})}
              className={cx(
                'rounded-md px-3 py-1.5 text-sm font-medium',
                status === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, office, phone, NET-…" className="pl-9" />
        </div>
      </div>
      <Card>
        {isLoading ? (
          <Spinner />
        ) : !data?.length ? (
          <Empty icon={<Users className="h-10 w-10" />} title="No customers found" />
        ) : (
          <Table head={['Customer', 'Office', 'Plan', 'Expires', 'Status', 'Wi-Fi']}>
            {data.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <Td>
                  <Link to={`/admin/customers/${c.id}`} className="block">
                    <span className="font-semibold text-slate-900 hover:text-brand-700">{c.companyName}</span>
                    <span className="block text-xs text-slate-500">
                      {c.accountNo} · {c.contactName} · {c.phone}
                    </span>
                  </Link>
                </Td>
                <Td>{c.office?.unit ?? '—'}</Td>
                <Td>{c.service.planName ?? '—'}</Td>
                <Td>
                  {c.service.coverageEnd ? (
                    <>
                      {fmtDate(c.service.coverageEnd)}
                      <span className="block text-xs text-slate-500">{c.service.daysRemaining} days left</span>
                    </>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td>
                  <StatusBadge status={c.service.status} />
                </Td>
                <Td>
                  {c.network && c.network.enabled !== c.network.desiredEnabled ? (
                    <Link to="/admin/network?todo=1" className="text-xs font-semibold text-amber-700">
                      Turn {c.network.desiredEnabled ? 'ON' : 'OFF'}
                    </Link>
                  ) : c.network?.enabled ? (
                    <span className="text-xs font-medium text-emerald-700">On</span>
                  ) : (
                    <span className="text-xs text-slate-400">Off</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <AddCustomer open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function AddCustomer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: offices } = useOffices();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<{ id: string; tempPassword: string; email: string } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setLoading(true);
    setError('');
    try {
      const res = await api.post<{ id: string; tempPassword: string }>('/admin/customers', body);
      qc.invalidateQueries({ queryKey: ['admin-customers'] });
      setCreated({ ...res, email: body.email });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const close = () => {
    setCreated(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title={created ? 'Customer created' : 'Add customer'}>
      {created ? (
        <div className="space-y-4">
          <Alert tone="success">Share these login details with the customer. They can change the password after logging in.</Alert>
          <div className="space-y-2 rounded-lg bg-slate-50 p-4 font-mono text-sm">
            <p>Email: {created.email}</p>
            <p className="flex items-center justify-between">
              Password: {created.tempPassword} <CopyButton value={created.tempPassword} />
            </p>
          </div>
          <Button className="w-full" onClick={() => navigate(`/admin/customers/${created.id}`)}>
            Open customer
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Company / office name">
            <Input name="companyName" required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact name">
              <Input name="contactName" required />
            </Field>
            <Field label="Phone">
              <Input name="phone" required />
            </Field>
          </div>
          <Field label="Email (used to log in)">
            <Input name="email" type="email" required />
          </Field>
          <Field label="Office">
            <Select name="officeId" defaultValue="">
              <option value="">— None —</option>
              {offices?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.unit}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes">
            <Textarea name="notes" rows={2} />
          </Field>
          <Button type="submit" className="w-full" loading={loading}>
            Create customer
          </Button>
        </form>
      )}
    </Modal>
  );
}
