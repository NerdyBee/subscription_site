import { Link } from 'react-router-dom';
import { Banknote, CheckCircle2, Mail, MessageCircle, Phone, Router, UserPlus, Wifi } from 'lucide-react';
import { PlanCard } from '../../components/PlanCard';
import { Spinner } from '../../components/ui';
import { whatsappLink } from '../../lib/format';
import { usePlans, useSite, useTitle } from '../../lib/site';

function Hero({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <section className="border-b border-slate-100 bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-14">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">{title}</h1>
        <p className="mt-3 max-w-2xl text-slate-600">{subtitle}</p>
      </div>
    </section>
  );
}

export function Packages() {
  useTitle('Packages');
  const { data: plans, isLoading } = usePlans();
  return (
    <>
      <Hero title="Internet packages" subtitle="Prices are per office. Choose the package that fits your team. You can upgrade or renew any time." />
      <section className="mx-auto max-w-6xl px-4 py-14">
        {isLoading ? (
          <Spinner />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {plans?.map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                action={
                  <Link
                    to={`/register?plan=${p.id}`}
                    className="block rounded-lg bg-brand-600 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    Subscribe
                  </Link>
                }
              />
            ))}
          </div>
        )}
        <p className="mt-10 text-center text-sm text-slate-500">
          Already a customer?{' '}
          <Link to="/login" className="font-semibold text-brand-700">
            Log in to renew
          </Link>
        </p>
      </section>
    </>
  );
}

export function HowItWorks() {
  useTitle('How it works');
  const site = useSite();
  const steps = [
    [UserPlus, 'Create your office account', 'Sign up with your company name and office number. You get an account ID such as NET-00241.'],
    [Wifi, 'Choose a package', 'Pick a monthly office plan or a daily pass. We generate an invoice with a payment reference.'],
    [Banknote, 'Pay by bank transfer', 'Transfer from your banking app to our account and use your invoice number as the narration.'],
    [CheckCircle2, 'Tell us you’ve paid', 'Tap “I have paid” and upload your transfer receipt. We confirm it, usually within minutes during business hours.'],
    [Router, 'You’re connected', 'Your subscription starts immediately and your Wi-Fi login appears on your dashboard. We remind you before it expires.'],
  ] as const;
  return (
    <>
      <Hero
        title="How it works"
        subtitle={`Getting your office in ${site.complexName || 'the complex'} online takes a few minutes.`}
      />
      <section className="mx-auto max-w-3xl px-4 py-14">
        <ol className="relative space-y-10 border-l-2 border-brand-100 pl-8">
          {steps.map(([Icon, title, body], i) => (
            <li key={title} className="relative">
              <span className="absolute -left-[49px] flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white ring-4 ring-white">
                {i + 1}
              </span>
              <h3 className="flex items-center gap-2 font-semibold text-slate-900">
                <Icon className="h-5 w-5 text-brand-600" /> {title}
              </h3>
              <p className="mt-1 text-slate-600">{body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-12 rounded-2xl bg-slate-50 p-6 ring-1 ring-slate-200">
          <h3 className="font-semibold text-slate-900">Renewing</h3>
          <p className="mt-1 text-sm text-slate-600">
            If you renew before your plan ends, the new period starts when the current one finishes, so you never lose paid days.
            {site.reminderDays.length > 0 &&
              ` We remind you ${site.reminderDays
                .slice()
                .sort((a, b) => b - a)
                .join(', ')} day(s) before expiry.`}
          </p>
        </div>
        <div className="mt-8 text-center">
          <Link to="/register" className="inline-block rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700">
            Get started
          </Link>
        </div>
      </section>
    </>
  );
}

export function Support() {
  useTitle('Support');
  const site = useSite();
  const channels = [
    site.whatsappNumber && {
      icon: MessageCircle,
      title: 'WhatsApp',
      body: 'The fastest way to reach us.',
      href: whatsappLink(site.whatsappNumber, `Hello ${site.brandName}`),
      cta: 'Chat now',
    },
    site.supportPhone && { icon: Phone, title: 'Call us', body: site.supportPhone, href: `tel:${site.supportPhone}`, cta: 'Call' },
    site.supportEmail && { icon: Mail, title: 'Email', body: site.supportEmail, href: `mailto:${site.supportEmail}`, cta: 'Send email' },
  ].filter(Boolean) as { icon: typeof Mail; title: string; body: string; href: string; cta: string }[];

  const faqs = [
    ['How long does payment confirmation take?', 'We usually confirm transfers within minutes during business hours. You get a notification on your dashboard as soon as you’re connected.'],
    ['What should I write as the transfer narration?', 'Your invoice number (e.g. INV-000123). It is shown on the payment page with a copy button.'],
    ['Can I upgrade in the middle of a month?', 'Yes. Contact us and we’ll move you to the new package. Renewals made before expiry are added on top of your remaining days.'],
    ['My internet is slow or down. What do I do?', 'Log in and open a support ticket, or message us on WhatsApp. Include your account ID so we can find you quickly.'],
  ];

  return (
    <>
      <Hero title="Support" subtitle="We’re based in the complex and happy to help." />
      <section className="mx-auto max-w-6xl px-4 py-14">
        {channels.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-3">
            {channels.map((c) => (
              <a key={c.title} href={c.href} target="_blank" rel="noreferrer" className="rounded-2xl p-6 ring-1 ring-slate-200 hover:ring-brand-300">
                <c.icon className="h-6 w-6 text-brand-600" />
                <h3 className="mt-3 font-semibold text-slate-900">{c.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{c.body}</p>
                <p className="mt-3 text-sm font-semibold text-brand-700">{c.cta} →</p>
              </a>
            ))}
          </div>
        )}
        <div className="mt-6 rounded-2xl bg-brand-50 p-6 text-sm text-brand-900 ring-1 ring-brand-100">
          Existing customer?{' '}
          <Link to="/account/support" className="font-semibold underline">
            Open a support ticket
          </Link>{' '}
          from your dashboard to track your request.
        </div>
        <h2 className="mt-14 text-xl font-bold text-slate-900">Frequently asked questions</h2>
        <div className="mt-4 divide-y divide-slate-200 rounded-2xl ring-1 ring-slate-200">
          {faqs.map(([q, a]) => (
            <details key={q} className="group px-6 py-4">
              <summary className="cursor-pointer list-none font-medium text-slate-900 marker:hidden">
                <span className="flex items-center justify-between gap-4">
                  {q}
                  <span className="text-slate-400 transition group-open:rotate-45">+</span>
                </span>
              </summary>
              <p className="mt-2 text-sm text-slate-600">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
