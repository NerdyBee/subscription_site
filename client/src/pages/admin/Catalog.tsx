import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Spinner, Table, Td, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { duration, naira } from '../../lib/format';
import { useTitle } from '../../lib/site';
import type { Plan } from '../../lib/types';
import { useAdminPlans } from './CustomerDetail';
import { useOffices, type Office } from './Customers';

export function Packages() {
  useTitle('Packages');
  const { data, isLoading } = useAdminPlans();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const qc = useQueryClient();

  async function remove(p: Plan) {
    if (!confirm(`Delete ${p.name}?`)) return;
    try {
      await api.del(`/admin/plans/${p.id}`);
      qc.invalidateQueries({ queryKey: ['admin-plans'] });
      qc.invalidateQueries({ queryKey: ['plans'] });
    } catch (e) {
      alert(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        title="Packages"
        subtitle="What customers can buy. Price changes apply to new invoices only."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> New package
          </Button>
        }
      />
      <Card>
        {isLoading ? (
          <Spinner />
        ) : (
          <Table head={['Package', 'Speed', 'Duration', 'Price', 'Visibility', 'Sold', '']}>
            {data?.map((p) => (
              <tr key={p.id}>
                <Td>
                  <span className="font-semibold">{p.name}</span> {p.isFeatured && <Badge tone="blue">Featured</Badge>}
                  {p.description && <span className="block max-w-xs truncate text-xs text-slate-500">{p.description}</span>}
                </Td>
                <Td>{p.speed}</Td>
                <Td>{duration(p.durationDays)}</Td>
                <Td className="font-semibold">{naira(p.priceKobo)}</Td>
                <Td>{p.isActive ? <Badge tone="green">On sale</Badge> : <Badge>Hidden</Badge>}</Td>
                <Td>{p.subscriptionCount}</Td>
                <Td className="text-right">
                  <button onClick={() => setEditing(p)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Edit">
                    <Pencil className="h-4 w-4" />
                  </button>
                  {!p.subscriptionCount && (
                    <button onClick={() => remove(p)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && <PlanForm plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PlanForm({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: f.get('name'),
      description: f.get('description'),
      speed: f.get('speed'),
      durationDays: Number(f.get('durationDays')),
      price: Number(f.get('price')),
      features: String(f.get('features'))
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      isActive: f.get('isActive') === 'on',
      isFeatured: f.get('isFeatured') === 'on',
      sortOrder: Number(f.get('sortOrder') || 0),
    };
    setLoading(true);
    setError('');
    try {
      if (plan) await api.put(`/admin/plans/${plan.id}`, body);
      else await api.post('/admin/plans', body);
      qc.invalidateQueries({ queryKey: ['admin-plans'] });
      qc.invalidateQueries({ queryKey: ['plans'] });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={plan ? `Edit ${plan.name}` : 'New package'} wide>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input name="name" defaultValue={plan?.name} required placeholder="Office Plus" />
          </Field>
          <Field label="Speed / policy" hint="Shown to customers">
            <Input name="speed" defaultValue={plan?.speed} required placeholder="Up to 50 Mbps" />
          </Field>
        </div>
        <Field label="Short description">
          <Input name="description" defaultValue={plan?.description ?? ''} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Price (₦)">
            <Input name="price" type="number" min={0} step="0.01" defaultValue={plan ? plan.priceKobo / 100 : ''} required />
          </Field>
          <Field label="Duration (days)" hint="1 = daily pass, 30 = monthly">
            <Input name="durationDays" type="number" min={1} max={366} defaultValue={plan?.durationDays ?? 30} required />
          </Field>
          <Field label="Display order">
            <Input name="sortOrder" type="number" defaultValue={plan?.sortOrder ?? 0} />
          </Field>
        </div>
        <Field label="Features" hint="One per line">
          <Textarea name="features" defaultValue={plan?.features.join('\n')} rows={4} placeholder={'Up to 15 devices\nPriority support'} />
        </Field>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="isActive" defaultChecked={plan?.isActive ?? true} /> On sale (visible to customers)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="isFeatured" defaultChecked={plan?.isFeatured} /> Highlight as “Most popular”
          </label>
        </div>
        <Button type="submit" className="w-full" loading={loading}>
          {plan ? 'Save changes' : 'Create package'}
        </Button>
      </form>
    </Modal>
  );
}

export function Offices() {
  useTitle('Offices');
  const { data, isLoading } = useOffices();
  const [editing, setEditing] = useState<Office | 'new' | null>(null);
  const qc = useQueryClient();

  return (
    <>
      <PageHeader
        title="Offices"
        subtitle="Units in the complex and who occupies them."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> Add office
          </Button>
        }
      />
      <Card>
        {isLoading ? (
          <Spinner />
        ) : !data?.length ? (
          <Empty icon={<Building2 className="h-10 w-10" />} title="No offices yet">
            Offices are also added automatically when customers enter their suite number at sign-up.
          </Empty>
        ) : (
          <Table head={['Unit', 'Floor / block', 'Customers', 'Notes', '']}>
            {data.map((o) => (
              <tr key={o.id}>
                <Td className="font-semibold">{o.unit}</Td>
                <Td>{[o.floor, o.block].filter(Boolean).join(' / ') || '—'}</Td>
                <Td>
                  {o.customers.length
                    ? o.customers.map((c) => (
                        <Link key={c.id} to={`/admin/customers/${c.id}`} className="mr-2 text-brand-700 hover:underline">
                          {c.companyName}
                        </Link>
                      ))
                    : <span className="text-slate-400">Vacant</span>}
                </Td>
                <Td className="max-w-xs truncate text-slate-500">{o.notes}</Td>
                <Td className="text-right">
                  <button onClick={() => setEditing(o)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Edit">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete ${o.unit}? Customers in it will be unlinked.`)) return;
                      await api.del(`/admin/offices/${o.id}`);
                      qc.invalidateQueries({ queryKey: ['offices'] });
                    }}
                    className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && <OfficeForm office={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function OfficeForm({ office, onClose }: { office: Office | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    setLoading(true);
    try {
      if (office) await api.put(`/admin/offices/${office.id}`, body);
      else await api.post('/admin/offices', body);
      qc.invalidateQueries({ queryKey: ['offices'] });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={office ? `Edit ${office.unit}` : 'Add office'}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Unit / suite">
          <Input name="unit" defaultValue={office?.unit} required placeholder="Suite B14" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Floor">
            <Input name="floor" defaultValue={office?.floor ?? ''} />
          </Field>
          <Field label="Block / wing">
            <Input name="block" defaultValue={office?.block ?? ''} />
          </Field>
        </div>
        <Field label="Notes" hint="e.g. which access point serves it">
          <Textarea name="notes" defaultValue={office?.notes ?? ''} rows={2} />
        </Field>
        <Button type="submit" className="w-full" loading={loading}>
          Save
        </Button>
      </form>
    </Modal>
  );
}
