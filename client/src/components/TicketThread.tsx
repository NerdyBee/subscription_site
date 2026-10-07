import { useState, type FormEvent, type ReactNode } from 'react';
import { Button, Card, cx, Textarea } from './ui';
import { fmtDateTime } from '../lib/format';
import type { TicketDetail } from '../lib/types';

/** Conversation view shared by the customer and admin ticket pages. */
export function TicketThread({
  ticket,
  viewer,
  onReply,
  extraActions,
}: {
  ticket: TicketDetail;
  viewer: 'customer' | 'staff';
  onReply: (body: string) => Promise<void>;
  extraActions?: ReactNode;
}) {
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    try {
      await onReply(body);
      setBody('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {ticket.messages.map((m) => {
        const mine = viewer === 'staff' ? m.fromStaff : !m.fromStaff;
        return (
          <div key={m.id} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
            <div
              className={cx(
                'max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm',
                mine ? 'rounded-br-sm bg-brand-600 text-white' : 'rounded-bl-sm bg-white ring-1 ring-slate-200',
              )}
            >
              <p className={cx('mb-1 text-xs font-semibold', mine ? 'text-brand-100' : 'text-slate-500')}>
                {m.fromStaff ? (viewer === 'customer' ? 'Support team' : m.authorName) : m.authorName}
              </p>
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className={cx('mt-1 text-[11px]', mine ? 'text-brand-200' : 'text-slate-400')}>{fmtDateTime(m.createdAt)}</p>
            </div>
          </div>
        );
      })}
      <Card className="p-4">
        <form onSubmit={submit} className="space-y-3">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Write a reply…" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">{extraActions}</div>
            <Button type="submit" loading={loading} disabled={!body.trim()}>
              Send reply
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
