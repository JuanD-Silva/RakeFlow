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
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token');
      // Opcional: window.location.href = '/login'; 
    }
    return Promise.reject(error);
  }
);

export default api;