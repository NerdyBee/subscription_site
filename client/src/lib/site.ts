import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Plan, SiteSettings } from './types';

export const fallbackSite: SiteSettings = {
  brandName: 'Office Internet',
  tagline: '',
  complexName: '',
  address: '',
  poweredBy: '',
  supportPhone: '',
  supportEmail: '',
  whatsappNumber: '',
  bankAccounts: [],
  paymentInstructions: '',
  reminderDays: [],
};

export function useSite() {
  const { data } = useQuery({
    queryKey: ['site'],
    queryFn: () => api.get<SiteSettings>('/public/site'),
    staleTime: 5 * 60 * 1000,
  });
  return data ?? fallbackSite;
}

export function usePlans() {
  return useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/public/plans') });
}

export function useTitle(title?: string) {
  const site = useSite();
  useEffect(() => {
    document.title = title ? `${title} · ${site.brandName}` : site.brandName;
  }, [title, site.brandName]);
}
