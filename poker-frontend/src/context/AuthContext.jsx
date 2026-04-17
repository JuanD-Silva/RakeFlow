import { createContext, useContext, useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';

const AuthContext = createContext(null);

function syncSentryUser(token) {
  if (!token) {
    Sentry.setUser(null);
    return;
  }
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    Sentry.setUser({ id: String(payload.club_id ?? ''), email: payload.sub });
    Sentry.setTag('club_id', String(payload.club_id ?? ''));
  } catch {
    Sentry.setUser(null);
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    const t = localStorage.getItem('token');
    syncSentryUser(t);
    return t;
  });

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

  return (
    <AuthContext.Provider value={{ token, login, logout }}>
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
