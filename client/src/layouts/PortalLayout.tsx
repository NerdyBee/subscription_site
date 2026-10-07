import { useState, type ComponentType } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { LogOut, Menu, X } from 'lucide-react';
import { Logo, NotificationBell, WhatsAppFab } from '../components/brand';
import { cx, Spinner } from '../components/ui';
import { isStaffRole, useAuth } from '../lib/auth';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
  badge?: number;
  superOnly?: boolean;
}

export default function PortalLayout({ nav, area }: { nav: NavItem[]; area: 'admin' | 'account' }) {
  const { user, ready, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  if (!ready) return <Spinner className="min-h-screen items-center" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (area === 'admin' && !isStaffRole(user.role)) return <Navigate to="/account" replace />;
  if (area === 'account' && isStaffRole(user.role)) return <Navigate to="/admin" replace />;

  const items = nav.filter((n) => !n.superOnly || user.role === 'SUPER_ADMIN');

  const sidebar = (
    <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4">
      {items.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cx(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
              isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )
          }
        >
          <n.icon className="h-[18px] w-[18px] shrink-0" />
          <span className="flex-1">{n.label}</span>
          {!!n.badge && (
            <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] leading-none font-bold text-white">{n.badge}</span>
          )}
        </NavLink>
      ))}
    </nav>
  );

  const userBox = (
    <div className="border-t border-slate-100 p-3">
      <div className="flex items-center gap-3 rounded-lg px-2 py-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
          {(user.companyName ?? user.name).slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{user.companyName ?? user.name}</p>
          <p className="truncate text-xs text-slate-500">{user.accountNo ?? (user.role === 'SUPER_ADMIN' ? 'Super admin' : 'Admin')}</p>
        </div>
        <button onClick={logout} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Log out">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center border-b border-slate-100 px-5">
          <Logo to={area === 'admin' ? '/admin' : '/account'} />
        </div>
        {area === 'admin' && <p className="px-6 pt-4 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Admin portal</p>}
        {sidebar}
        {userBox}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-slate-100 px-5">
              <Logo to={area === 'admin' ? '/admin' : '/account'} />
              <button onClick={() => setOpen(false)} className="p-1 text-slate-400" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-1 flex-col overflow-y-auto">{sidebar}</div>
            {userBox}
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 text-slate-600 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-6 w-6" />
          </button>
          <div className="lg:hidden">
            <Logo to={area === 'admin' ? '/admin' : '/account'} />
          </div>
          <div className="hidden text-sm text-slate-500 lg:block">
            {area === 'admin' ? `Signed in as ${user.name}` : user.accountNo && `Account ${user.accountNo}`}
          </div>
          <NotificationBell />
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
      {area === 'account' && <WhatsAppFab />}
    </div>
  );
}
