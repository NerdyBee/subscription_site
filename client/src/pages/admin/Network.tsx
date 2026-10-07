import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Pencil, Router } from 'lucide-react';
import { Alert, Badge, Button, Card, cx, Empty, Field, Input, Modal, PageHeader, Spinner, StatusBadge, Table, Td, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useTitle } from '../../lib/site';
import type { CustomerRef, Subscription } from '../../lib/types';

interface Account {
  id: string;
  username: string;
  password: string;
  macAddresses: string[];
  enabled: boolean;
  desiredEnabled: boolean;
  lastSyncedAt: string | null;
  notes: string | null;
  customer: CustomerRef & { office: string | null };
}

export default function Network() {
  useTitle('Network access');
  const [params, setParams] = useSearchParams();
  const todo = params.get('todo') === '1';
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-network', todo],
    queryFn: () => api.get<{ adapter: { name: string; automatic: boolean }; accounts: Account[] }>(`/admin/network${todo ? '?todo=1' : ''}`),
  });
  const [editing, setEditing] = useState<Account | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function confirmState(a: Account, enabled: boolean) {
    setBusy(a.id);
    await api.patch(`/admin/network/${a.id}`, { enabled }).finally(() => setBusy(null));
    qc.invalidateQueries({ queryKey: ['admin-network'] });
    qc.invalidateQueries({ queryKey: ['admin-stats'] });
  }

  return (
    <>
      <PageHeader title="Network access" subtitle="Wi-Fi / hotspot accounts for each customer." />
      {data && !data.adapter.automatic && (
        <Alert className="mb-4">
          <span className="flex gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <b>Manual mode.</b> The router isn’t connected to the portal yet. When a customer pays or expires, the account shows up
              under “To do”. Make the change on the router, then tap the button to confirm it here.
            </span>
          </span>
        </Alert>
      )}
      <div className="mb-4 inline-flex gap-1 rounded-lg bg-slate-100 p-1">
        {[
          [true, 'To do'],
          [false, 'All accounts'],
        ].map(([k, l]) => (
          <button
            key={String(k)}
            onClick={() => setParams(k ? { todo: '1' } : {})}
            className={cx('rounded-md px-3 py-1.5 text-sm font-medium', todo === k ? 'bg-white shadow-sm' : 'text-slate-600')}
          >
            {l as string}
          </button>
        ))}
      </div>
      <Card>
        {isLoading ? (
          <Spinner />
        ) : !data?.accounts.length ? (
          <Empty icon={<Router className="h-10 w-10" />} title={todo ? 'Router is in sync' : 'No accounts yet'}>
            {todo && 'Nothing to switch on or off right now.'}
          </Empty>
        ) : (
          <Table head={['Customer', 'Login', 'Should be', 'Router', 'Last change', '']}>
            {data.accounts.map((a) => {
              const mismatch = a.enabled !== a.desiredEnabled;
              return (
                <tr key={a.id} className={cx(mismatch && 'bg-amber-50/50')}>
                  <Td>
                    <Link to={`/admin/customers/${a.customer.id}`} className="font-medium hover:text-brand-700">
                      {a.customer.companyName}
                    </Link>
                    <span className="block text-xs text-slate-500">
                      {a.customer.accountNo}
                      {a.customer.office && ` · ${a.customer.office}`}
                    </span>
                  </Td>
                  <Td className="font-mono text-xs">
                    {a.username}
                    <span className="block text-slate-500">{a.password}</span>
                  </Td>
                  <Td>{a.desiredEnabled ? <Badge tone="green">ON</Badge> : <Badge>OFF</Badge>}</Td>
                  <Td>
                    {a.enabled ? <Badge tone="green">ON</Badge> : <Badge>OFF</Badge>}
                  </Td>
                  <Td className="text-xs text-slate-500">{fmtDateTime(a.lastSyncedAt)}</Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {mismatch && (
                        <Button
                          size="sm"
                          variant={a.desiredEnabled ? 'success' : 'danger'}
                          loading={busy === a.id}
                          onClick={() => confirmState(a, a.desiredEnabled)}
                        >
                          I turned it {a.desiredEnabled ? 'ON' : 'OFF'}
                        </Button>
                      )}
                      <button onClick={() => setEditing(a)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      <EditAccount account={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function EditAccount({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  if (!account) return null;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setLoading(true);
    setError('');
    try {
      await api.patch(`/admin/network/${account!.id}`, {
        username: f.username,
        password: f.password,
        notes: f.notes,
        enabled: f.enabled === 'on',
        macAddresses: f.macAddresses.split(/[\s,]+/).filter(Boolean),
      });
      qc.invalidateQueries({ queryKey: ['admin-network'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Access — ${account.customer.companyName}`}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <p className="text-sm text-slate-600">Keep these in sync with the hotspot user on your router. The customer sees the username and password on their dashboard.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Username">
            <Input name="username" defaultValue={account.username} required className="font-mono" />
          </Field>
          <Field label="Password">
            <Input name="password" defaultValue={account.password} required className="font-mono" />
          </Field>
        </div>
        <Field label="Device MAC addresses (optional)" hint="Separate with commas or spaces">
          <Input name="macAddresses" defaultValue={account.macAddresses.join(', ')} className="font-mono" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={account.enabled} /> Access is currently ON at the router
        </label>
        <Field label="Notes">
          <Textarea name="notes" defaultValue={account.notes ?? ''} rows={2} />
        </Field>
        <Button type="submit" className="w-full" loading={loading}>
          Save
        </Button>
      </form>
    </Modal>
  );
}

export function Subscriptions() {
  useTitle('Subscriptions');
  const [filter, setFilter] = useState('active');
  const { data, isLoading } = useQuery({
    queryKey: ['admin-subs', filter],
    queryFn: () => api.get<Subscription[]>(`/admin/subscriptions?filter=${filter}`),
  });
  const now = new Date();
  return (
    <>
      <PageHeader title="Subscriptions" subtitle="Paid periods across all customers." />
      <div className="mb-4 inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {(
          [
            ['active', 'Active'],
            ['expiring', 'Expiring in 7 days'],
            ['expired', 'Expired'],
            ['all', 'All'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={cx('rounded-md px-3 py-1.5 text-sm font-medium', filter === k ? 'bg-white shadow-sm' : 'text-slate-600')}>
            {l}
          </button>
        ))}
      </div>
      <Card>
        {isLoading ? (
          <Spinner />
        ) : !data?.length ? (
          <Empty title="No subscriptions" />
        ) : (
          <Table head={['Customer', 'Package', 'Starts', 'Expires', 'Days left', 'Status']}>
            {data.map((s) => {
              const left = Math.ceil((new Date(s.expiresAt).getTime() - now.getTime()) / 86_400_000);
              return (
                <tr key={s.id}>
                  <Td>
                    <Link to={`/admin/customers/${s.customer!.id}`} className="font-medium hover:text-brand-700">
                      {s.customer!.companyName}
                    </Link>
                    <span className="block text-xs text-slate-500">{s.customer!.accountNo}</span>
                  </Td>
                  <Td>{s.plan.name}</Td>
                  <Td>{fmtDate(s.startsAt)}</Td>
                  <Td>{fmtDate(s.expiresAt)}</Td>
                  <Td className={cx(s.status === 'ACTIVE' && left <= 3 && 'font-semibold text-amber-700')}>
                    {s.status === 'ACTIVE' ? Math.max(0, left) : '—'}
                  </Td>
                  <Td>
                    <StatusBadge status={s.status === 'ACTIVE' && new Date(s.startsAt) > now ? 'PENDING' : s.status} />
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
