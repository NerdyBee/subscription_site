import type { ReactNode } from 'react';
import { Check, Gauge } from 'lucide-react';
import { duration, naira, per } from '../lib/format';
import type { Plan } from '../lib/types';
import { cx } from './ui';

export function PlanCard({ plan, action, current }: { plan: Plan; action: ReactNode; current?: boolean }) {
  return (
    <div
      className={cx(
        'relative flex flex-col rounded-2xl bg-white p-6 shadow-sm ring-1',
        plan.isFeatured ? 'ring-2 ring-brand-600' : 'ring-slate-200',
      )}
    >
      {(plan.isFeatured || current) && (
        <span
          className={cx(
            'absolute -top-3 left-6 rounded-full px-3 py-1 text-xs font-semibold text-white',
            current ? 'bg-emerald-600' : 'bg-brand-600',
          )}
        >
          {current ? 'Your plan' : 'Most popular'}
        </span>
      )}
      <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
      {plan.description && <p className="mt-1 min-h-10 text-sm text-slate-500">{plan.description}</p>}
      <p className="mt-5 flex items-baseline gap-1">
        <span className="text-3xl font-extrabold tracking-tight text-slate-900">{naira(plan.priceKobo)}</span>
        <span className="text-sm text-slate-500">/ {per(plan.durationDays)}</span>
      </p>
      <p className="mt-3 flex items-center gap-2 text-sm font-medium text-brand-700">
        <Gauge className="h-4 w-4" /> {plan.speed}
      </p>
      <ul className="mt-5 flex-1 space-y-2.5 text-sm text-slate-600">
        <li className="flex gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> {duration(plan.durationDays)} access
        </li>
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> {f}
          </li>
        ))}
      </ul>
      <div className="mt-6">{action}</div>
    </div>
  );
}
