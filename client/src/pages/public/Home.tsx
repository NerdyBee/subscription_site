import { Link } from 'react-router-dom';
import { Building2, CalendarClock, CreditCard, Headphones, ShieldCheck, Zap } from 'lucide-react';
import { PlanCard } from '../../components/PlanCard';
import { Spinner } from '../../components/ui';
import { usePlans, useSite, useTitle } from '../../lib/site';

export default function Home() {
  const site = useSite();
  const { data: plans, isLoading } = usePlans();
  useTitle();

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-950 via-brand-900 to-brand-700 text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, #8ec3ff 0, transparent 40%), radial-gradient(circle at 10% 90%, #337dfc 0, transparent 35%)' }}
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 md:grid-cols-2 md:py-28">
          <div>
            {site.complexName && (
              <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium ring-1 ring-white/20">
                <Building2 className="h-4 w-4" /> For offices in {site.complexName}
              </p>
            )}
            <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl">Reliable high-speed internet for your office.</h1>
            <p className="mt-5 max-w-lg text-lg text-brand-100">{site.tagline}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register" className="rounded-lg bg-white px-6 py-3 font-semibold text-brand-800 shadow hover:bg-brand-50">
                Get connected
              </Link>
              <Link to="/packages" className="rounded-lg px-6 py-3 font-semibold text-white ring-1 ring-white/40 hover:bg-white/10">
                View packages
              </Link>
            </div>
            {site.poweredBy && <p className="mt-6 text-sm text-brand-200">{site.poweredBy}</p>}
          </div>
          <div className="hidden md:block">
            <div className="rounded-2xl bg-white/95 p-6 text-slate-800 shadow-2xl ring-1 ring-white/30">
              <p className="text-sm text-slate-500">Good morning, ABC Technologies</p>
              <div className="mt-4 flex items-center justify-between">
                <span className="font-semibold">Internet status</span>
                <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-600/20">ACTIVE</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                {[
                  ['Plan', 'Office Plus'],
                  ['Expires', '06 Nov'],
                  ['Remaining', '30 days'],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">{k}</p>
                    <p className="mt-1 text-sm font-bold">{v}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full w-full rounded-full bg-emerald-500" />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <span className="rounded-lg bg-brand-600 py-2 text-center text-sm font-semibold text-white">Renew</span>
                <span className="rounded-lg py-2 text-center text-sm font-semibold ring-1 ring-slate-300">Upgrade</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [Zap, 'Fast, stable connection', 'Satellite-backed internet built for video calls, cloud apps and everyday office work.'],
            [CreditCard, 'Simple bank transfer', 'Pay from your banking app. We confirm your payment and switch you on.'],
            [CalendarClock, 'Always know where you stand', 'See your plan, expiry date and days remaining from your dashboard.'],
            [ShieldCheck, 'Your own office account', 'Each office gets its own account and login, separate from other offices in the complex.'],
            [Headphones, 'On-site support', 'We’re in the same complex. Raise a ticket or message us on WhatsApp.'],
            [Building2, 'Built for businesses', 'Monthly office plans, plus a daily pass for occasional use.'],
          ].map(([Icon, title, body]) => {
            const I = Icon as typeof Zap;
            return (
              <div key={title as string} className="rounded-2xl p-6 ring-1 ring-slate-200">
                <div className="mb-4 inline-flex rounded-lg bg-brand-50 p-2.5 text-brand-700">
                  <I className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-slate-900">{title as string}</h3>
                <p className="mt-2 text-sm text-slate-600">{body as string}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Packages */}
      <section className="bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">Packages for every office</h2>
            <p className="mt-3 text-slate-600">No contracts. Renew when you need to, and upgrade any time.</p>
          </div>
          {isLoading ? (
            <Spinner />
          ) : (
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {plans?.map((p) => (
                <PlanCard
                  key={p.id}
                  plan={p}
                  action={
                    <Link
                      to={`/register?plan=${p.id}`}
                      className={
                        p.isFeatured
                          ? 'block rounded-lg bg-brand-600 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-700'
                          : 'block rounded-lg py-2.5 text-center text-sm font-semibold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50'
                      }
                    >
                      Choose {p.name}
                    </Link>
                  }
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-brand-600 p-8 text-white md:flex-row md:items-center md:p-12">
          <div>
            <h2 className="text-2xl font-bold">Ready to get your office online?</h2>
            <p className="mt-2 text-brand-100">Create an account in under a minute, choose a package and pay by bank transfer.</p>
          </div>
          <Link to="/register" className="shrink-0 rounded-lg bg-white px-6 py-3 font-semibold text-brand-700 hover:bg-brand-50">
            Create my account
          </Link>
        </div>
      </section>
    </>
  );
}
