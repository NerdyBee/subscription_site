import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Check, FileText, X } from 'lucide-react';
import { Alert, Button, Card, cx, Empty, Field, Input, Modal, PageHeader, Spinner, StatusBadge, Table, Td } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime, humanize, naira, timeAgo } from '../../lib/format';
import { useSite, useTitle } from '../../lib/site';
import type { Invoice, Payment } from '../../lib/types';

/** Opens the uploaded receipt (served behind auth, so fetched as a blob). */
export function ProofLink({ paymentId, label = 'Receipt' }: { paymentId: string; label?: string }) {
  const [loading, setLoading] = useState(false);
  return (
    <button
      type="button"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        const tab = window.open('', '_blank');
        try {
          const url = await api.blobUrl(`/payments/${paymentId}/proof`);
          if (tab) tab.location.href = url;
        } catch {
          tab?.close();
          alert('Could not open the receipt');
        } finally {
          setLoading(false);
        }
      }}
      className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
    >
      <FileText className="h-3.5 w-3.5" /> {loading ? 'Opening…' : label}
    </button>
  );
}

const tabs = [
  ['PENDING', 'To confirm'],
  ['APPROVED', 'Confirmed'],
  ['REJECTED', 'Rejected'],
  ['', 'All'],
] as const;

export default function Payments() {
  useTitle('Payments');
  const site = useSite();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'PENDING';
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-payments', status],
    queryFn: () => api.get<Payment[]>(`/admin/payments?status=${status}`),
    refetchInterval: status === 'PENDING' ? 30_000 : false,
  });
  const [rejecting, setRejecting] = useState<Payment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-payments'] });
    qc.invalidateQueries({ queryKey: ['admin-stats'] });
  };

  async function approve(p: Payment) {
    setBusy(p.id);
    try {
      await api.post(`/admin/payments/${p.id}/approve`);
      setNotice(`Confirmed ${naira(p.amountKobo)} from ${p.customer?.companyName}. Subscription activated — remember to switch their Wi-Fi on.`);
      refresh();
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle={
          site.bankAccounts.length
            ? `Check your ${site.bankAccounts.map((b) => b.bankName).join(' / ')} account for each transfer before confirming.`
            : 'Confirm customer transfers after checking your bank account.'
        }
        actions={<Link to="/admin/invoices" className="text-sm font-semibold text-brand-700">All invoices →</Link>}
      />
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 sm:inline-flex">
        {tabs.map(([k, l]) => (
          <button
            key={k}
            onClick={() => setParams({ status: k })}
            className={cx('rounded-md px-3 py-1.5 text-sm font-medium', status === k ? 'bg-white shadow-sm' : 'text-slate-600')}
          >
            {l}
          </button>
        ))}
      </div>
      {notice && <Alert tone="success" className="mb-4">{notice}</Alert>}

      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <Card>
          <Empty icon={<Banknote className="h-10 w-10" />} title={status === 'PENDING' ? 'No payments waiting' : 'Nothing here'}>
            {status === 'PENDING' && 'New “I have paid” submissions will appear here.'}
          </Empty>
        </Card>
      ) : status === 'PENDING' ? (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((p) => (
            <Card key={p.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link to={`/admin/customers/${p.customer!.id}`} className="font-semibold text-slate-900 hover:text-brand-700">
                    {p.customer!.companyName}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {p.customer!.accountNo} · submitted {timeAgo(p.createdAt)}
                  </p>
                </div>
                <p className="text-xl font-bold">{naira(p.amountKobo)}</p>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-slate-50 p-3 text-sm">
                <dt className="text-slate-500">Narration</dt>
                <dd className="font-mono font-semibold">{p.invoiceNo}</dd>
                <dt className="text-slate-500">Package</dt>
                <dd>{p.planName}</dd>
                <dt className="text-slate-500">Sender</dt>
                <dd>{p.senderName}</dd>
                {p.senderBank && (
                  <>
                    <dt className="text-slate-500">Bank</dt>
                    <dd>{p.senderBank}</dd>
                  </>
                )}
                {p.transferRef && (
                  <>
                    <dt className="text-slate-500">Reference</dt>
                    <dd className="break-all">{p.transferRef}</dd>
                  </>
                )}
              </dl>
              {p.note && <p className="mt-3 text-sm text-slate-600 italic">“{p.note}”</p>}
              <div className="mt-4 flex items-center justify-between gap-2">
                {p.hasProof ? <ProofLink paymentId={p.id} label="View receipt" /> : <span className="text-xs text-slate-400">No receipt uploaded</span>}
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setRejecting(p)} disabled={!!busy}>
                    <X className="h-4 w-4" /> Reject
                  </Button>
                  <Button size="sm" variant="success" onClick={() => approve(p)} loading={busy === p.id} disabled={!!busy}>
                    <Check className="h-4 w-4" /> Confirm
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <Table head={['Date', 'Customer', 'Invoice', 'Amount', 'Method', 'Status', '']}>
            {data.map((p) => (
              <tr key={p.id}>
                <Td>{fmtDateTime(p.createdAt)}</Td>
                <Td>
                  <Link to={`/admin/customers/${p.customer!.id}`} className="font-medium hover:text-brand-700">
                    {p.customer!.companyName}
                  </Link>
                </Td>
                <Td className="font-mono">{p.invoiceNo}</Td>
                <Td className="font-semibold">{naira(p.amountKobo)}</Td>
                <Td>{humanize(p.method)}</Td>
                <Td>
                  <StatusBadge status={p.status} />
                  {p.rejectReason && <span className="block text-xs text-slate-500">{p.rejectReason}</span>}
                </Td>
                <Td>{p.hasProof && <ProofLink paymentId={p.id} />}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <RejectModal payment={rejecting} onClose={() => setRejecting(null)} onDone={refresh} />
    </>
  );
}

function RejectModal({ payment, onClose, onDone }: { payment: Payment | null; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post(`/admin/payments/${payment!.id}/reject`, { reason: new FormData(e.currentTarget).get('reason') });
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }
  return (
    <Modal open={!!payment} onClose={onClose} title="Reject payment">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <p className="text-sm text-slate-600">
          The customer will be told why and can resubmit. The invoice stays open.
        </p>
        <Field label="Reason">
          <Input name="reason" required placeholder="e.g. No transfer received with this narration" />
        </Field>
        <Button type="submit" variant="danger" className="w-full" loading={loading}>
          Reject payment
        </Button>
      </form>
    </Modal>
  );
}

export function Invoices() {
  useTitle('Invoices');
  const [status, setStatus] = useState('');
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-invoices', status],
    queryFn: () => api.get<Invoice[]>(`/admin/invoices?status=${status}`),
  });
  return (
    <>
      <PageHeader title="Invoices" subtitle="Every package purchase creates an invoice. Its number is the transfer narration." />
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 sm:inline-flex">
        {(
          [
            ['', 'All'],
            ['UNPAID', 'Unpaid'],
            ['PENDING_VERIFICATION', 'Awaiting confirmation'],
            ['PAID', 'Paid'],
            ['CANCELLED', 'Cancelled'],
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
          <Empty title="No invoices" />
        ) : (
          <Table head={['Invoice', 'Customer', 'Package', 'Created', 'Amount', 'Status', '']}>
            {data.map((i) => (
              <tr key={i.id}>
                <Td className="font-mono">{i.number}</Td>
                <Td>
                  <Link to={`/admin/customers/${i.customer!.id}`} className="font-medium hover:text-brand-700">
                    {i.customer!.companyName}
                  </Link>
                </Td>
                <Td>{i.plan.name}</Td>
                <Td>{fmtDateTime(i.createdAt)}</Td>
                <Td className="font-semibold">{naira(i.amountKobo)}</Td>
                <Td>
                  <StatusBadge status={i.status} />
                </Td>
                <Td className="text-right">
                  {(i.status === 'UNPAID' || i.status === 'PENDING_VERIFICATION') && (
                    <button
                      className="text-xs font-medium text-red-600"
                      onClick={async () => {
                        if (!confirm(`Cancel ${i.number}?`)) return;
                        await api.post(`/admin/invoices/${i.id}/cancel`);
                        qc.invalidateQueries({ queryKey: ['admin-invoices'] });
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
