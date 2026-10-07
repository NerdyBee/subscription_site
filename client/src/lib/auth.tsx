import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, setAccessToken, setSessionListener } from './api';
import type { SessionUser } from './types';

interface AuthState {
  user: SessionUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  register: (input: Record<string, string>) => Promise<SessionUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

type Session = { accessToken: string; user: SessionUser };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    setSessionListener(setUser);
    refreshSession().finally(() => setReady(true));
  }, []);

  const accept = useCallback((s: Session) => {
    setAccessToken(s.accessToken);
    setUser(s.user);
    return s.user;
  }, []);

  const login = useCallback(
    async (email: string, password: string) => accept(await api.post<Session>('/auth/login', { email, password })),
    [accept],
  );
  const register = useCallback(
    async (input: Record<string, string>) => accept(await api.post<Session>('/auth/register', input)),
    [accept],
  );
  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    qc.clear();
  }, [qc]);

  return <AuthContext.Provider value={{ user, ready, login, register, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export const isStaffRole = (role?: string) => role === 'ADMIN' || role === 'SUPER_ADMIN';
