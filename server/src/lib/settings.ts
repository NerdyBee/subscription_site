import { z } from 'zod';
import { prisma } from '../db';

export const bankAccountSchema = z.object({
  bankName: z.string().trim().min(1),
  accountName: z.string().trim().min(1),
  accountNumber: z.string().trim().regex(/^\d{10}$/, 'must be 10 digits'),
});

export const settingsSchema = z.object({
  brandName: z.string().trim().min(1),
  tagline: z.string().trim(),
  complexName: z.string().trim(),
  address: z.string().trim(),
  poweredBy: z.string().trim(),
  supportPhone: z.string().trim(),
  supportEmail: z.string().trim(),
  whatsappNumber: z.string().trim(), // international format without +, e.g. 2348012345678
  bankAccounts: z.array(bankAccountSchema),
  paymentInstructions: z.string().trim(),
  reminderDays: z.array(z.number().int().min(0).max(60)),
});

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = {
  brandName: 'SkyLink Office Internet',
  tagline: 'Fast, dependable connectivity for every business in the complex. Pay monthly, no contracts.',
  complexName: 'Your Business Complex',
  address: '',
  poweredBy: 'Internet connectivity powered by Starlink',
  supportPhone: '',
  supportEmail: '',
  whatsappNumber: '',
  bankAccounts: [],
  paymentInstructions:
    'Transfer the exact amount to the account below and use your invoice number as the narration/description. Then tap "I have paid" and upload your receipt screenshot. Your internet is switched on as soon as we confirm the payment.',
  reminderDays: [7, 3, 1],
};

const KEY = 'site';

export async function getSettings(): Promise<Settings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  return { ...defaultSettings, ...((row?.value as Partial<Settings>) ?? {}) };
}

export async function saveSettings(input: Settings) {
  const value = settingsSchema.parse(input);
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return value;
}
