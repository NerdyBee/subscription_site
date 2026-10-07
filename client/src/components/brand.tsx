import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, MessageCircle, Wifi } from 'lucide-react';
import { api } from '../lib/api';
import { timeAgo, whatsappLink } from '../lib/format';
import { useSite } from '../lib/site';
import type { Notification } from '../lib/types';
import { cx } from './ui';

export function Logo({ to = '/', light }: { to?: string; light?: boolean }) {
  const site = useSite();
  return (
    <Link to={to} className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
        <Wifi className="h-5 w-5" strokeWidth={2.5} />
      </span>
      <span className={cx('text-base leading-tight font-bold', light ? 'text-white' : 'text-slate-900')}>{site.brandName}</span>
    </Link>
  );
}

export function WhatsAppFab({ text }: { text?: string }) {
  const site = useSite();
  if (!site.whatsappNumber) return null;
  return (
    <a
      href={whatsappLink(site.whatsappNumber, text ?? `Hello ${site.brandName}, I need help with my internet.`)}
      target="_blank"
      rel="noreferrer"
      className="no-print fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-3 text-sm font-semibold text-white shadow-lg hover:brightness-95"
    >
      <MessageCircle className="h-5 w-5" />
      <span className="hidden sm:inline">Chat on WhatsApp</span>
    </a>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ unread: number; items: Notification[] }>('/notifications'),
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open && data?.unread) markRead.mutate();
        }}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {!!data?.unread && (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {data.unread > 9 ? '9+' : data.unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Notifications</div>
          <div className="max-h-96 overflow-y-auto">
            {!data?.items.length && <p className="px-4 py-8 text-center text-sm text-slate-500">You’re all caught up.</p>}
            {data?.items.map((n) => (
              <div key={n.id} className={cx('border-b border-slate-50 px-4 py-3', !n.readAt && 'bg-brand-50/60')}>
                <p className="text-sm font-medium text-slate-900">{n.title}</p>
                <p className="mt-0.5 text-xs text-slate-600">{n.body}</p>
                <p className="mt-1 text-[11px] text-slate-400">{timeAgo(n.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
