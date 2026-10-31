import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, post } from '../services/api';
import type { User } from '../services/types';

type AuthContextValue = { user: User | null; loading: boolean; login: (email: string, password: string) => Promise<User>; register: (name: string, email: string, password: string) => Promise<User>; logout: () => Promise<void>; refresh: () => Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async (): Promise<void> => { try { const result = await api<{ user: User }>('/auth/me'); setUser(result.user); } catch { setUser(null); } finally { setLoading(false); } };
  useEffect(() => { void refresh(); }, []);
  const value = useMemo<AuthContextValue>(() => ({
    user, loading, refresh,
    login: async (email, password) => { const result = await post<{ user: User }>('/auth/login', { email, password }); setUser(result.user); return result.user; },
    register: async (name, email, password) => { const result = await post<{ user: User }>('/auth/register', { name, email, password }); setUser(result.user); return result.user; },
    logout: async () => { await post<void>('/auth/logout'); setUser(null); }
  }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
};
