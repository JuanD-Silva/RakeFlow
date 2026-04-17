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

   create: async (data, phone = null) => {
        // Lógica inteligente:
        // Si 'data' es un string, asumimos que es el nombre y el 2do argumento es el teléfono.
        // Si 'data' es un objeto, lo usamos tal cual.

        let payload = {};

        if (typeof data === 'string') {
            payload = { 
                name: data, 
                phone: phone, // Aquí usamos el 2do argumento
                club_id: 1 
            };
        } else {
            // Si ya viene como objeto {name: "Juan", phone: "300...", club_id: 1}
            payload = { 
                ...data, 
                club_id: data.club_id || 1 
            };
        }

        const response = await api.post('/players/', payload);
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
    },

    togglePaid: async (playerId, sessionId, isPaid) => {
        return await api.post('/transactions/toggle-paid', {
            player_id: playerId,
            session_id: sessionId,
            is_paid: isPaid
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

export const tournamentService = {
  // Buscar si hay un torneo corriendo
  findActive: async () => {
    try {
      const response = await api.get('/tournaments/active');
      return response.data;
    } catch (error) {
      console.error("Error buscando torneo activo:", error);
      return null;
    }
  },
  registerPlayer: async (tournamentId, data) => {
     // data: { player_id: 1, pay_buyin: true, pay_tip: true }
     const response = await api.post(`/tournaments/${tournamentId}/register`, data);
     return response.data;
  },

  // 2. PAGAR TIP TARDE (Nivel 6, etc)
  payLateTip: async (tournamentId, playerId) => {
    const response = await api.post(`/tournaments/${tournamentId}/players/${playerId}/pay-tip`);
    return response.data;
  },

  // Crear un torneo nuevo
  create: async (data) => {
    // data debe tener: { name, buyin_amount, fee_amount, bounty_amount }
    const response = await api.post('/tournaments/', data);
    return response.data;
  },

endTournament: async (tournamentId) => {
    // Asumimos que crearás este endpoint en el backend pronto
    // OJO: Si aún no tienes el endpoint DELETE o PUT para cerrar, 
    // tendremos que crearlo en Python primero.
    const response = await api.post(`/tournaments/${tournamentId}/end`); 
    return response.data;
  },

  addRebuy: async (tournamentId, playerId, type) => {
      // type debe ser "SINGLE" o "DOUBLE"
      const response = await api.post(`/tournaments/${tournamentId}/rebuy`, { player_id: playerId, type });
      return response.data;
  },

  addAddon: async (tournamentId, playerId, type) => {
      const response = await api.post(`/tournaments/${tournamentId}/addon`, { player_id: playerId, type });
      return response.data;
  },

  finalize: async (tournamentId, winnersList) => {
      // winnersList debe ser: [{ rank: 1, player_id: 5 }, { rank: 2, player_id: 8 }]
      const response = await api.post(`/tournaments/${tournamentId}/finalize`, { winners: winnersList });
      return response.data;
  },
  getDetails: async (id) => {
    const response = await api.get(`/tournaments/${id}/details`);
    return response.data;
  },
  eliminatePlayer: async (tournamentId, playerId) => {
    const response = await api.post(`/tournaments/${tournamentId}/players/${playerId}/eliminate`);
    return response.data;
  },
  undoAction: async (tournamentId, playerId, action, type) => {
    const response = await api.post(`/tournaments/${tournamentId}/undo`, { player_id: playerId, action, type });
    return response.data;
  },
  toggleBuyinPaid: async (tournamentId, playerId) => {
    const response = await api.post(`/tournaments/${tournamentId}/players/${playerId}/toggle-paid`);
    return response.data;
  },
};

export const historyService = {
    getAll: async () => {
        const response = await api.get('/history/'); 
        return response.data;
    }
};

const getAll = async () => {
    // Llamamos al endpoint que acabamos de crear
    const response = await api.get('/stats/history-mixed');
    return response.data;
};

export default {
    getAll,
};


