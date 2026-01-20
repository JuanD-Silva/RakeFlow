// src/api/services.js
import api from './axios';

// --- GESTIÓN DE MESAS ---
export const sessionService = {
    // Verificar si hay mesa abierta
    getActiveSession: async () => {
        // Como no tenemos un endpoint específico de "check status", 
        // usamos el de stats. Si falla (404), es que no hay mesa.
        try {
            const response = await api.get('/sessions/current/players-stats');
            return response.data; // Retorna la lista de jugadores activos
        } catch (error) {
            return null; // No hay sesión activa
        }
    },

createSession: async () => {
        const response = await api.post('/sessions/', {}); 
        return response.data;
    },

    closeSession: async (sessionId, declaredRake, declaredJackpot, forceClose = false) => {
        const payload = {
            declared_rake_cash: declaredRake,
            declared_jackpot_cash: declaredJackpot,
            force_close: forceClose
        };
        const response = await api.post(`/sessions/${sessionId}/close`, payload);
        return response.data;
    },

    getSessionDetails: async (sessionId) => {
        const response = await api.get(`/sessions/${sessionId}/details`);
        return response.data;
    },

    findOpenSession: async () => {
        const response = await api.get('/sessions/?skip=0&limit=20'); // Traemos las últimas
        const sessions = response.data;
        // Buscamos la primera que esté OPEN
        return sessions.find(s => s.status === "OPEN") || null;
    },

    // 👇 AGREGA ESTO: Para el botón de auditar
    getAuditData: async () => {
        const response = await api.get('/audit/current-session');
        return response.data;
    }
};

// --- GESTIÓN DE JUGADORES ---
export const playerService = {
    getAll: async () => {
        const response = await api.get('/players/');
        return response.data;
    },

    create: async (name, phone) => {
        // Asumimos club_id = 1 por defecto para este MVP
        const response = await api.post('/players/', { name, phone, club_id: 1 });
        return response.data;
    }
};

// --- TRANSACCIONES (DINERO) ---
export const transactionService = {
    buyin: async (playerId, amount, method = "CASH") => {
        return await api.post('/transactions/buyin', { player_id: playerId, amount, method });
    },

    cashout: async (playerId, amount) => {
        return await api.post('/transactions/cashout', { player_id: playerId, amount });
    },

    spend: async (playerId, amount) => { // Gastos de cocina/bebida
        return await api.post('/transactions/spend', { player_id: playerId, amount });
    },

    jackpotPayout: async (playerId, amount) => {
        return await api.post('/transactions/jackpot-payout', { player_id: playerId, amount });
    },
    tip: async (playerId, amount) => {
        return await api.post('/transactions/tip', { player_id: playerId, amount });
    }
};

// --- ESTADÍSTICAS Y CONFIGURACIÓN ---
export const statsService = {
    getGlobalJackpot: async () => {
        const response = await api.get('/stats/jackpot-global');
        return response.data.total_jackpot;
    },

    getMonthlyQuota: async () => {
        const response = await api.get('/stats/monthly-debt-quota');
        return response.data;
    },

    getWeeklyReport: async (startDate, endDate) => {
        // Construimos la query string
        let url = '/stats/weekly-distribution';
        if (startDate && endDate) {
            url += `?start_date=${startDate}&end_date=${endDate}`;
        }
        const response = await api.get(url);
        return response.data;
    }

    
};

