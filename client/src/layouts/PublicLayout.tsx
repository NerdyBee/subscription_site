import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Mail, MapPin, Menu, Phone, X } from 'lucide-react';
import { Logo, WhatsAppFab } from '../components/brand';
import { cx } from '../components/ui';
import { isStaffRole, useAuth } from '../lib/auth';
import { useSite } from '../lib/site';

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/packages', label: 'Packages' },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/support', label: 'Support' },
];

export default function PublicLayout() {
  const { user } = useAuth();
  const site = useSite();
  const [open, setOpen] = useState(false);
  const portal = user ? (isStaffRole(user.role) ? '/admin' : '/account') : null;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  cx('rounded-lg px-3 py-2 text-sm font-medium', isActive ? 'text-brand-700' : 'text-slate-600 hover:text-slate-900')
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            {portal ? (
              <Link to={portal} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                My dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                  Log in
                </Link>
                <Link to="/register" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                  Get connected
                </Link>
              </>
            )}
          </div>
          <button className="rounded-lg p-2 text-slate-600 md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
        {open && (
          <div className="border-t border-slate-100 px-4 py-3 md:hidden" onClick={() => setOpen(false)}>
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className="block rounded-lg px-3 py-2.5 font-medium text-slate-700 hover:bg-slate-50">
                {l.label}
              </NavLink>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {portal ? (
                <Link to={portal} className="col-span-2 rounded-lg bg-brand-600 px-4 py-2.5 text-center font-semibold text-white">
                  My dashboard
                </Link>
              ) : (
                <>
                  <Link to="/login" className="rounded-lg px-4 py-2.5 text-center font-semibold text-slate-700 ring-1 ring-slate-300">
                    Log in
                  </Link>
                  <Link to="/register" className="rounded-lg bg-brand-600 px-4 py-2.5 text-center font-semibold text-white">
                    Get connected
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-slate-950 text-slate-400">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-3">
          <div>
            <Logo light />
            <p className="mt-3 text-sm">{site.tagline}</p>
            {site.poweredBy && <p className="mt-3 text-xs text-slate-500">{site.poweredBy}</p>}
          </div>
          <div className="text-sm">
            <p className="mb-3 font-semibold text-white">Quick links</p>
            <ul className="space-y-2">
              {links.slice(1).map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/login" className="hover:text-white">
                  Customer login
                </Link>
              </li>
            </ul>
          </div>
          <div className="space-y-2 text-sm">
            <p className="mb-3 font-semibold text-white">Contact</p>
            {(site.address || site.complexName) && (
              <p className="flex gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                {[site.complexName, site.address].filter(Boolean).join(', ')}
              </p>
            )}
            {site.supportPhone && (
              <a href={`tel:${site.supportPhone}`} className="flex gap-2 hover:text-white">
                <Phone className="mt-0.5 h-4 w-4" />
                {site.supportPhone}
              </a>
            )}
            {site.supportEmail && (
              <a href={`mailto:${site.supportEmail}`} className="flex gap-2 hover:text-white">
                <Mail className="mt-0.5 h-4 w-4" />
                {site.supportEmail}
              </a>
            )}
          </div>
        </div>
        <div className="border-t border-white/10 py-5 text-center text-xs">
          © {new Date().getFullYear()} {site.brandName}. All rights reserved.
        </div>
      </footer>
      <WhatsAppFab />
    </div>
  );
}
