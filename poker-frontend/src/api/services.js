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
        const response = await api.get('/sessions/audit/current-session');
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
    // 👇 Ahora recibimos sessionId en TODOS
    buyin: async (playerId, amount, method = "CASH", sessionId) => {
        return await api.post('/transactions/buyin', { 
            player_id: playerId, 
            amount, 
            method,
            session_id: sessionId // <--- ¡Esto faltaba!
        });
    },

    cashout: async (playerId, amount, sessionId) => {
        return await api.post('/transactions/cashout', { 
            player_id: playerId, 
            amount,
            session_id: sessionId 
        });
    },

    spend: async (playerId, amount, sessionId) => { 
        return await api.post('/transactions/spend', { 
            player_id: playerId, 
            amount,
            session_id: sessionId 
        });
    },

    jackpotPayout: async (playerId, amount, sessionId) => {
        return await api.post('/transactions/jackpot-payout', { 
            player_id: playerId, 
            amount,
            session_id: sessionId 
        });
    },
    
    tip: async (playerId, amount, sessionId) => {
        return await api.post('/transactions/tip', { 
            // Tip a veces no lleva player_id, pero sí necesita session_id
            player_id: playerId, 
            amount,
            session_id: sessionId 
        });
    },

    bonus: async (playerId, amount, sessionId) => {
        return await api.post('/transactions/bonus', { 
            player_id: playerId, 
            amount, 
            session_id: sessionId
        });
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

export const authService = {
login: async (email, password) => {
    const formData = new URLSearchParams();
    formData.append('username', email);
    formData.append('password', password);

    // 👇 AQUÍ ESTÁ EL CAMBIO CLAVE
    // Agregamos el tercer argumento con los headers explícitos
    const response = await api.post('/auth/login', formData, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });
    
    return response.data;
},

    register: async (userData) => {
        // El registro sí suele ser JSON normal
        const response = await api.post('/auth/register', userData);
        return response.data;
    },

    getCurrentUser: async () => {
        const response = await api.get('/users/me');
        return response.data;
    }
};

