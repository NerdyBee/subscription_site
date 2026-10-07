import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PlanCard } from '../../components/PlanCard';
import { Alert, Button, PageHeader, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { usePlans, useTitle } from '../../lib/site';
import type { Invoice } from '../../lib/types';
import { useOverview } from './Dashboard';

export default function Subscribe() {
  useTitle('Choose a package');
  const { data: plans, isLoading } = usePlans();
  const { data: overview } = useOverview();
  const [params] = useSearchParams();
  const preselected = params.get('plan');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function choose(planId: string) {
    setBusy(planId);
    setError('');
    try {
      const invoice = await api.post<Invoice>('/me/invoices', { planId });
      qc.invalidateQueries({ queryKey: ['overview'] });
      navigate(`/account/invoices/${invoice.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const currentPlanId = overview?.current?.plan.id;

  return (
    <>
      <PageHeader
        title={overview?.current ? 'Renew or change your plan' : 'Choose a package'}
        subtitle={
          overview?.coverageEnd
            ? `You’re covered until ${fmtDate(overview.coverageEnd)}. A renewal starts when that ends, so you don’t lose any days.`
            : 'Your subscription starts as soon as we confirm your payment.'
        }
      />
      {error && <Alert tone="error" className="mb-6">{error}</Alert>}
      {isLoading ? (
        <Spinner />
      ) : (
        <div className="grid gap-6 pt-3 sm:grid-cols-2 xl:grid-cols-4">
          {plans?.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              current={p.id === currentPlanId}
              action={
                <Button
                  className="w-full"
                  variant={p.id === preselected || (p.isFeatured && !preselected) ? 'primary' : 'secondary'}
                  loading={busy === p.id}
                  disabled={!!busy}
                  onClick={() => choose(p.id)}
                >
                  {p.id === currentPlanId ? 'Renew' : 'Select'} {p.name}
                </Button>
              }
            />
          ))}
        </div>
      )}
    </>
  );
}
