export const accountNo = (seq: number) => `NET-${String(seq).padStart(5, '0')}`;
export const invoiceNo = (seq: number) => `INV-${String(seq).padStart(6, '0')}`;
export const ticketNo = (seq: number) => `TKT-${String(seq).padStart(5, '0')}`;

export const naira = (kobo: number) =>
  `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** JSON column that holds a list of strings (MySQL has no array columns). */
export const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export const DAY_MS = 24 * 60 * 60 * 1000;
export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);

export const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
