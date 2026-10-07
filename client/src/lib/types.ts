export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'CUSTOMER';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  customerId: string | null;
  companyName: string | null;
  accountNo: string | null;
}

export interface BankAccount {
  bankName: string;
  accountName: string;
  accountNumber: string;
}

export interface SiteSettings {
  brandName: string;
  tagline: string;
  complexName: string;
  address: string;
  poweredBy: string;
  supportPhone: string;
  supportEmail: string;
  whatsappNumber: string;
  bankAccounts: BankAccount[];
  paymentInstructions: string;
  reminderDays: number[];
}

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  speed: string;
  durationDays: number;
  priceKobo: number;
  features: string[];
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  subscriptionCount?: number;
}

export interface CustomerRef {
  id: string;
  companyName: string;
  accountNo: string;
}

export interface Customer {
  id: string;
  accountNo: string;
  companyName: string;
  contactName: string;
  phone: string;
  whatsapp: string | null;
  email?: string;
  status: 'ACTIVE' | 'SUSPENDED';
  notes: string | null;
  office: { id: string; unit: string; floor: string | null; block: string | null } | null;
  createdAt: string;
}

export type InvoiceStatus = 'UNPAID' | 'PENDING_VERIFICATION' | 'PAID' | 'CANCELLED';
export type PaymentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type PaymentMethod = 'BANK_TRANSFER' | 'CASH' | 'POS' | 'OTHER';
export type ServiceStatus = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'SUSPENDED' | 'NO_SUBSCRIPTION';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export interface Payment {
  id: string;
  invoiceId: string;
  invoiceNo?: string;
  planName?: string;
  amountKobo: number;
  method: PaymentMethod;
  status: PaymentStatus;
  senderName: string | null;
  senderBank: string | null;
  transferRef: string | null;
  hasProof: boolean;
  note: string | null;
  rejectReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  customer?: CustomerRef;
}

export interface Invoice {
  id: string;
  number: string;
  status: InvoiceStatus;
  amountKobo: number;
  plan: { id: string; name: string; speed: string; durationDays: number };
  paidAt: string | null;
  createdAt: string;
  payments?: Payment[];
  customer?: CustomerRef;
  subscription?: { startsAt: string; expiresAt: string } | null;
}

export interface Subscription {
  id: string;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  startsAt: string;
  expiresAt: string;
  plan: { id: string; name: string; speed: string; priceKobo: number; durationDays: number };
  invoiceId: string | null;
  createdAt: string;
  customer?: CustomerRef;
}

export interface Overview {
  customer: Customer;
  serviceStatus: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'NO_SUBSCRIPTION';
  current: Subscription | null;
  lastPlan: Subscription['plan'] | null;
  coverageEnd: string | null;
  daysRemaining: number;
  upcoming: Subscription[];
  network: { username: string; password: string; enabled: boolean; desiredEnabled: boolean } | null;
  recentPayments: Payment[];
  openInvoice: Invoice | null;
}

export interface Ticket {
  id: string;
  number: string;
  subject: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  customer?: CustomerRef;
}

export interface TicketDetail extends Ticket {
  messages: { id: string; body: string; createdAt: string; authorName: string; fromStaff: boolean }[];
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}
