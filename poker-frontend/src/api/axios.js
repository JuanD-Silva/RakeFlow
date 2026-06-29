// src/api/axios.js
import axios from 'axios';


const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

// URL de tu Backend
const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 👇 INTERCEPTOR MÁGICO
// Antes de cada petición, busca el token y pégalo en el header
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 👇 INTERCEPTOR DE ERRORES
// Si el token expiró (Error 401), borra todo y manda al login
// Excepto en rutas de auth (login, register, forgot-password, reset-password)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      const url = error.config?.url || '';
      const isAuthRoute = url.includes('/auth/login') || url.includes('/auth/register') || url.includes('/auth/forgot') || url.includes('/auth/reset');
      if (!isAuthRoute) {
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Instancia PÚBLICA (sin token, sin interceptor de 401→logout) para las
// páginas públicas (link del club, vista dealer). El recurso se identifica por
// un token imposible de adivinar en la URL, no por sesión autenticada.
export const publicApi = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

export default api;