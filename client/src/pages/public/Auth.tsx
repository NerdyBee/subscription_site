import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../../components/brand';
import { Alert, Button, Field, Input } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { isStaffRole, useAuth } from '../../lib/auth';
import { useSite, useTitle } from '../../lib/site';

function AuthShell({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  const site = useSite();
  return (
    <div className="flex min-h-screen">
      <div className="flex flex-1 flex-col justify-center px-4 py-12 sm:px-6 lg:px-20">
        <div className="mx-auto w-full max-w-sm">
          <Logo />
          <h1 className="mt-8 text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-2 text-sm text-slate-600">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
      <div className="relative hidden flex-1 bg-gradient-to-br from-brand-950 to-brand-700 lg:flex lg:items-end">
        <div className="p-12 text-white">
          <p className="text-3xl font-bold">{site.brandName}</p>
          <p className="mt-3 max-w-md text-brand-100">{site.tagline}</p>
          {site.poweredBy && <p className="mt-6 text-sm text-brand-200">{site.poweredBy}</p>}
        </div>
      </div>
    </div>
  );
}

export function Login() {
  useTitle('Log in');
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError('');
    setLoading(true);
    try {
      const user = await login(String(f.get('email')), String(f.get('password')));
      const from = (location.state as { from?: string } | null)?.from;
      const home = isStaffRole(user.role) ? '/admin' : '/account';
      navigate(from && from.startsWith(home) ? from : home, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle={
        <>
          New here?{' '}
          <Link to="/register" className="font-semibold text-brand-700">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Email address">
          <Input name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={loading}>
          Log in
        </Button>
        <p className="text-center text-xs text-slate-500">Forgot your password? Contact support and we’ll reset it for you.</p>
      </form>
    </AuthShell>
  );
}

export function Register() {
  useTitle('Create account');
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (f.password !== f.confirm) {
      setError('Passwords do not match');
      return;
    }
    delete f.confirm;
    setError('');
    setLoading(true);
    try {
      await register(f);
      const plan = params.get('plan');
      navigate(plan ? `/account/subscribe?plan=${plan}` : '/account/subscribe', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Get your office connected"
      subtitle={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand-700">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Company / office name">
          <Input name="companyName" required placeholder="ABC Technologies" autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name">
            <Input name="contactName" required autoComplete="name" />
          </Field>
          <Field label="Office / suite number">
            <Input name="officeUnit" placeholder="Suite B14" />
          </Field>
        </div>
        <Field label="Email address">
          <Input name="email" type="email" required autoComplete="email" />
        </Field>
        <Field label="Phone (WhatsApp)">
          <Input name="phone" type="tel" required placeholder="0801 234 5678" autoComplete="tel" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Password" hint="At least 8 characters">
            <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
          </Field>
          <Field label="Confirm password">
            <Input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
          </Field>
        </div>
        <Button type="submit" className="w-full" size="lg" loading={loading}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
