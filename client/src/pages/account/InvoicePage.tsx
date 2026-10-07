import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Clock, Landmark, Printer, Upload, Wifi } from 'lucide-react';
import { Alert, Button, Card, CardHeader, CopyButton, DefinitionList, Field, Input, Spinner, StatusBadge, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { duration, fmtDate, fmtDateTime, humanize, naira, whatsappLink } from '../../lib/format';
import { useSite, useTitle } from '../../lib/site';
import { useAuth } from '../../lib/auth';
import type { Invoice } from '../../lib/types';

export default function InvoicePage() {
  const { id } = useParams();
  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get<Invoice>(`/me/invoices/${id}`),
  });
  useTitle(invoice?.number ?? 'Invoice');
  if (isLoading || !invoice) return <Spinner />;

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/account/billing" className="no-print mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Billing
      </Link>
      {invoice.status === 'PAID' ? (
        <Receipt invoice={invoice} />
      ) : invoice.status === 'PENDING_VERIFICATION' ? (
        <Pending invoice={invoice} />
      ) : invoice.status === 'UNPAID' ? (
        <PayInvoice invoice={invoice} />
      ) : (
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">{invoice.number}</h1>
            <StatusBadge status={invoice.status} />
          </div>
          <p className="mt-2 text-sm text-slate-600">This invoice was cancelled.</p>
          <Link to="/account/subscribe" className="mt-4 inline-block text-sm font-semibold text-brand-700">
            Choose a package →
          </Link>
        </Card>
      )}
    </div>
  );
}

function Summary({ invoice }: { invoice: Invoice }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-900 px-6 py-5 text-white">
      <div>
        <p className="text-sm text-slate-400">
          {invoice.number} · {invoice.plan.name} · {duration(invoice.plan.durationDays)}
        </p>
        <p className="mt-1 text-3xl font-extrabold tracking-tight">{naira(invoice.amountKobo)}</p>
      </div>
      <StatusBadge status={invoice.status} />
    </div>
  );
}

function PayInvoice({ invoice }: { invoice: Invoice }) {
  const site = useSite();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const rejected = invoice.payments?.find((p) => p.status === 'REJECTED');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const form = new FormData(e.currentTarget);
      if (!(form.get('proof') as File | null)?.size) form.delete('proof');
      await api.post(`/me/invoices/${invoice.id}/payments`, form);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['invoice', invoice.id] }),
        qc.invalidateQueries({ queryKey: ['overview'] }),
      ]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function cancel() {
    if (!confirm('Cancel this invoice?')) return;
    await api.post(`/me/invoices/${invoice.id}/cancel`);
    qc.invalidateQueries({ queryKey: ['overview'] });
    navigate('/account/subscribe');
  }

  return (
    <div className="space-y-6">
      <Summary invoice={invoice} />
      {rejected && (
        <Alert tone="error">
          We couldn’t confirm your last payment: <b>{rejected.rejectReason}</b>. Please check the details and submit again.
        </Alert>
      )}

      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">1</span>Transfer the money</span>}
          subtitle={site.paymentInstructions}
        />
        <div className="space-y-4 p-5">
          {site.bankAccounts.length === 0 ? (
            <Alert tone="warning">Bank details have not been set up yet. Please contact support to pay.</Alert>
          ) : (
            site.bankAccounts.map((b) => (
              <div key={b.accountNumber} className="rounded-xl bg-brand-50 p-5 ring-1 ring-brand-100">
                <p className="flex items-center gap-2 text-sm font-semibold text-brand-900">
                  <Landmark className="h-4 w-4" /> {b.bankName}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="font-mono text-2xl font-bold tracking-wider text-slate-900">{b.accountNumber}</span>
                  <CopyButton value={b.accountNumber} />
                </div>
                <p className="mt-1 text-sm text-slate-600">{b.accountName}</p>
              </div>
            ))
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg p-4 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Amount</p>
              <div className="flex items-center justify-between">
                <p className="text-lg font-bold">{naira(invoice.amountKobo)}</p>
                <CopyButton value={String(invoice.amountKobo / 100)} />
              </div>
            </div>
            <div className="rounded-lg p-4 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Narration / description</p>
              <div className="flex items-center justify-between">
                <p className="font-mono text-lg font-bold">{invoice.number}</p>
                <CopyButton value={invoice.number} />
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">2</span>Tell us you’ve paid</span>}
          subtitle="Add your transfer details so we can match your payment quickly."
        />
        <form onSubmit={submit} className="space-y-4 p-5">
          {error && <Alert tone="error">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name on the sending account" hint="As it will appear on our bank statement">
              <Input name="senderName" required defaultValue={user?.companyName ?? ''} />
            </Field>
            <Field label="Your bank">
              <Input name="senderBank" placeholder="e.g. GTBank, Opay, Moniepoint" />
            </Field>
          </div>
          <Field label="Transaction reference (optional)">
            <Input name="transferRef" placeholder="From your bank app’s receipt" />
          </Field>
          <Field label="Transfer receipt (screenshot or PDF)" hint="Optional, but helps us confirm faster. Max 5 MB.">
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-slate-300 px-4 py-4 text-sm text-slate-600 hover:border-brand-400 hover:bg-brand-50/40">
              <Upload className="h-5 w-5 text-slate-400" />
              <span className="truncate">{fileName || 'Tap to choose a file'}</span>
              <input
                type="file"
                name="proof"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                className="sr-only"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
              />
            </label>
          </Field>
          <Field label="Note (optional)">
            <Textarea name="note" rows={2} />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button type="button" onClick={cancel} className="text-sm font-medium text-slate-500 hover:text-red-600">
              Cancel invoice
            </button>
            <Button type="submit" size="lg" loading={loading}>
              <CheckCircle2 className="h-5 w-5" /> I have paid
            </Button>
          </div>
        </form>
      </Card>
      {site.whatsappNumber && (
        <p className="text-center text-sm text-slate-500">
          Prefer to send the receipt on WhatsApp?{' '}
          <a
            className="font-semibold text-brand-700"
            target="_blank"
            rel="noreferrer"
            href={whatsappLink(site.whatsappNumber, `Hello, I just paid ${naira(invoice.amountKobo)} for ${invoice.number} (${user?.accountNo}).`)}
          >
            Send it here
          </a>
        </p>
      )}
    </div>
  );
}

function Pending({ invoice }: { invoice: Invoice }) {
  const site = useSite();
  const { user } = useAuth();
  const p = invoice.payments?.find((x) => x.status === 'PENDING');
  return (
    <div className="space-y-6">
      <Summary invoice={invoice} />
      <Card className="p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <Clock className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-slate-900">Thanks! We’re confirming your payment</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
          We’ll check our account for your transfer and switch your internet on. You’ll get a notification on your dashboard
          as soon as it’s done.
        </p>
        {p && (
          <div className="mx-auto mt-6 max-w-sm text-left">
            <DefinitionList
              items={[
                ['Submitted', fmtDateTime(p.createdAt)],
                ['Sender', p.senderName],
                ...(p.senderBank ? ([['Bank', p.senderBank]] as [string, string][]) : []),
                ['Receipt attached', p.hasProof ? 'Yes' : 'No'],
              ]}
            />
          </div>
        )}
        {site.whatsappNumber && (
          <a
            className="mt-6 inline-block text-sm font-semibold text-brand-700"
            target="_blank"
            rel="noreferrer"
            href={whatsappLink(site.whatsappNumber, `Hello, please confirm my payment for ${invoice.number} (${user?.accountNo}).`)}
          >
            Taking long? Message us on WhatsApp
          </a>
        )}
      </Card>
    </div>
  );
}

function Receipt({ invoice }: { invoice: Invoice }) {
  const site = useSite();
  const { user } = useAuth();
  const payment = invoice.payments?.find((p) => p.status === 'APPROVED');
  return (
    <>
      <div className="no-print mb-4 flex items-center justify-between">
        <Alert tone="success" className="flex-1">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> Paid on {fmtDate(invoice.paidAt)}
          </span>
        </Alert>
        <Button variant="secondary" className="ml-3" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print
        </Button>
      </div>
      <Card className="p-8 print:shadow-none print:ring-0">
        <div className="flex items-start justify-between gap-6 border-b border-slate-200 pb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
                <Wifi className="h-4 w-4" />
              </span>
              <span className="font-bold">{site.brandName}</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">{[site.complexName, site.address].filter(Boolean).join(', ')}</p>
            <p className="text-xs text-slate-500">{[site.supportPhone, site.supportEmail].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-extrabold tracking-tight text-slate-900">RECEIPT</p>
            <p className="mt-1 font-mono text-sm">{invoice.number}</p>
          </div>
        </div>
        <div className="grid gap-6 py-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Billed to</p>
            <p className="mt-1 font-semibold">{user?.companyName}</p>
            <p className="text-sm text-slate-600">Account {user?.accountNo}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Payment</p>
            <p className="mt-1 text-sm">{fmtDateTime(invoice.paidAt)}</p>
            {payment && <p className="text-sm text-slate-600">{humanize(payment.method)}</p>}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-slate-200 text-left text-xs text-slate-500 uppercase">
              <th className="py-2">Description</th>
              <th className="py-2">Period</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="py-3">
                <p className="font-medium">{invoice.plan.name}</p>
                <p className="text-xs text-slate-500">{invoice.plan.speed} · {duration(invoice.plan.durationDays)}</p>
              </td>
              <td className="py-3 text-slate-600">
                {invoice.subscription ? `${fmtDate(invoice.subscription.startsAt)} – ${fmtDate(invoice.subscription.expiresAt)}` : '—'}
              </td>
              <td className="py-3 text-right font-medium">{naira(invoice.amountKobo)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="pt-4 text-right font-semibold">Total paid</td>
              <td className="pt-4 text-right text-lg font-bold">{naira(payment?.amountKobo ?? invoice.amountKobo)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-10 text-center text-xs text-slate-400">
          Thank you for your business. {site.poweredBy}
        </p>
      </Card>
    </>
  );
}
