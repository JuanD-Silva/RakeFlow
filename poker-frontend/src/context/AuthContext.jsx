import { createContext, useContext, useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';

const AuthContext = createContext(null);

function decodePayload(token) {
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

function syncSentryUser(token) {
  const payload = decodePayload(token);
  if (!payload) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: String(payload.club_id ?? ''), email: payload.sub });
  Sentry.setTag('club_id', String(payload.club_id ?? ''));
  if (payload.role) Sentry.setTag('role', String(payload.role));
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    const t = localStorage.getItem('token');
    syncSentryUser(t);
    return t;
  });

  const payload = decodePayload(token);
  const role = payload?.role || null;
  const userId = payload?.user_id ?? null;
  const clubId = payload?.club_id ?? null;
  const email = payload?.sub ?? null;

  // Sincronizar token entre pestanas
  useEffect(() => {
    const handleStorageChange = () => {
      const t = localStorage.getItem('token');
      syncSentryUser(t);
      setToken(t);
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const login = (newToken) => {
    localStorage.setItem('token', newToken);
    syncSentryUser(newToken);
    setToken(newToken);
  };

  const logout = () => {
    localStorage.removeItem('token');
    syncSentryUser(null);
    setToken(null);
  };

  const isOwner = role === 'owner';
  const isManager = role === 'manager';
  const isCashier = role === 'cashier';
  const canManageUsers = isOwner;
  const canSeeReports = isOwner || isManager;

  return (
    <AuthContext.Provider value={{
      token, login, logout,
      role, userId, clubId, email,
      isOwner, isManager, isCashier,
      canManageUsers, canSeeReports,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  }
  return context;
}
