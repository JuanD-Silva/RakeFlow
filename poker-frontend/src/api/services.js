// src/api/services.js
import api, { publicApi } from './axios';

// --- CAPA PÚBLICA (sin auth) ---
export const publicService = {
    getClubActivity: async (token) => (await publicApi.get(`/public/clubs/${token}/activity`)).data,
    getDealerView: async (token) => (await publicApi.get(`/public/dealer/${token}`)).data,
    sendDealerAlert: async (token, alertType, message = null) =>
        (await publicApi.post(`/public/dealer/${token}/alert`, { alert_type: alertType, message })).data,
    toggleBust: async (token, playerId) =>
        (await publicApi.post(`/public/dealer/${token}/bust`, { player_id: playerId })).data,
    // Activación de cuenta de dealer (verifica número + crea contraseña)
    activateDealer: async ({ phone, code, name, password }) =>
        (await publicApi.post('/dealers/activate', { phone, code, name, password })).data,
    // Vista TV pública del torneo (reloj + blinds + conteos, sin login)
    getTournamentTV: async (token) => (await publicApi.get(`/public/tournaments/${token}/tv`)).data,
};

// --- LINK PÚBLICO DEL CLUB + ALERTAS (lado staff, autenticado) ---
export const clubPublicService = {
    get: async () => (await api.get('/config/club-public')).data,
    updateAnnouncement: async (text) => (await api.patch('/config/club-public', { public_announcement: text })).data,
};

export const alertService = {
    listPending: async () => (await api.get('/dealer-alerts?status=PENDING')).data,
    resolve: async (id) => (await api.post(`/dealer-alerts/${id}/resolve`)).data,
};

// --- GESTIÓN DE MESAS ---
export const sessionService = {
    // Carga players-stats. Si recibe sessionId apunta a esa mesa especifica;
    // sino cae al endpoint legacy /current/players-stats (primera OPEN).
    getActiveSession: async (sessionId = null) => {
        try {
            const path = sessionId
                ? `/sessions/${sessionId}/players-stats`
                : '/sessions/current/players-stats';
            const response = await api.get(path);
            return response.data;
        } catch (error) {
            return null;
        }
    },

    createSession: async (name = null, maxPlayers = null) => {
        const payload = {};
        if (name) payload.name = name;
        if (maxPlayers) payload.max_players = maxPlayers;
        const response = await api.post('/sessions/', payload);
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

    // Preview read-only del rake bruto vs neto antes de cerrar (no cierra nada)
    closePreview: async (sessionId, declaredRake) => {
        const res = await api.post(`/sessions/${sessionId}/close-preview`, {
            declared_rake_cash: declaredRake,
            declared_jackpot_cash: 0,
        });
        return res.data;
    },

    getSessionDetails: async (sessionId) => {
        const response = await api.get(`/sessions/${sessionId}/details`);
        return response.data;
    },

    // [DEPRECADO multi-mesa] Devuelve la primera OPEN. Usar findOpenSessions.
    findOpenSession: async () => {
        const response = await api.get('/sessions/?skip=0&limit=50');
        return response.data.find(s => s.status === "OPEN") || null;
    },

    // Lista todas las sesiones OPEN del club con stats agregados (players_count,
    // total_buyin, total_cashout, last_activity_at). Multi-mesa.
    findOpenSessions: async () => {
        try {
            const response = await api.get('/sessions/active-summary');
            return response.data;
        } catch (err) {
            // Fallback al endpoint viejo por si el deploy del backend va atrasado
            const response = await api.get('/sessions/?skip=0&limit=50');
            return response.data.filter(s => s.status === "OPEN");
        }
    },

    // Auditoria por mesa especifica (multi-mesa)
    getAuditDataForTable: async (sessionId) => {
        const response = await api.get(`/sessions/${sessionId}/audit`);
        return response.data;
    },

    // [DEPRECADO multi-mesa] Audit de la mesa "actual" (primera OPEN).
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
    
    tip: async (playerId, amount, sessionId, dealerId = null) => {
        return await api.post('/transactions/tip', {
            // Tip a veces no lleva player_id, pero sí necesita session_id.
            // dealer_id (opcional): a qué dealer se le dio la propina.
            player_id: playerId,
            amount,
            session_id: sessionId,
            dealer_id: dealerId
        });
    },

    bonus: async (playerId, amount, sessionId) => {
        return await api.post('/transactions/bonus', {
            player_id: playerId,
            amount,
            session_id: sessionId
        });
    },

    // Bono para toda la mesa: un BONUS por cada jugador activo
    bonusAll: async (amount, sessionId) => {
        return await api.post('/transactions/bonus-all', {
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
    },

    togglePaidById: async (transactionId, isPaid) => {
        return await api.post(`/transactions/${transactionId}/toggle-paid`, {
            is_paid: isPaid
        });
    },

    toggleBust: async (playerId, sessionId = null) => {
        const payload = { player_id: playerId };
        if (sessionId) payload.session_id = sessionId;
        const response = await api.post('/transactions/bust', payload);
        return response.data;
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
    },

    getDealerPayments: async (startDate, endDate) => {
        let url = '/stats/dealer-payments';
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
  // --- Reloj del torneo (T3). El backend calcula elapsed/remaining; el front tickea local. ---
  getClock: async (tournamentId) => {
    const response = await api.get(`/tournaments/${tournamentId}/clock`);
    return response.data;
  },
  clockStart: async (tournamentId) => (await api.post(`/tournaments/${tournamentId}/clock/start`)).data,
  clockPause: async (tournamentId) => (await api.post(`/tournaments/${tournamentId}/clock/pause`)).data,
  clockNextLevel: async (tournamentId) => (await api.post(`/tournaments/${tournamentId}/clock/next-level`)).data,
  clockPrevLevel: async (tournamentId) => (await api.post(`/tournaments/${tournamentId}/clock/prev-level`)).data,
  updateBlinds: async (tournamentId, blindStructure) =>
    (await api.patch(`/tournaments/${tournamentId}/blinds`, { blind_structure: blindStructure })).data,
};

export const historyService = {
    getAll: async () => {
        const response = await api.get('/history/');
        return response.data;
    }
};

// --- WOMPI (pasarela de pagos: tokenizacion + cobro recurrente) ---
export const wompiService = {
    getConfig: async () => {
        const res = await api.get('/payments/wompi/config');
        return res.data;
    },
    confirmTransaction: async (transactionId) => {
        const res = await api.post('/payments/wompi/confirm', { transaction_id: transactionId });
        return res.data;
    },
};

// --- DEALERS (turnos en mesa cash: horas + % del rake) ---
export const dealerService = {
    list: async (includeInactive = false) => {
        const res = await api.get(`/dealers/?include_inactive=${includeInactive}`);
        return res.data;
    },
    create: async ({ name, phone = null, hourly_rate_cop = 0, rake_pct = 0 }) => {
        const res = await api.post('/dealers/', { name, phone, hourly_rate_cop, rake_pct });
        return res.data;
    },
    update: async (dealerId, payload) => {
        const res = await api.patch(`/dealers/${dealerId}`, payload);
        return res.data;
    },
    deactivate: async (dealerId) => {
        await api.delete(`/dealers/${dealerId}`);
    },
    // Borrado definitivo (solo si no tiene historial; el backend lo valida)
    remove: async (dealerId) => {
        await api.delete(`/dealers/${dealerId}/permanent`);
    },
    getShifts: async (sessionId) => {
        const res = await api.get(`/sessions/${sessionId}/dealer-shifts`);
        return res.data;
    },
    startShift: async (sessionId, dealerId, force = false) => {
        const res = await api.post(`/sessions/${sessionId}/dealer-shifts/start`, { dealer_id: dealerId, force });
        return res.data;
    },
    changeShift: async (sessionId, dealerId, declaredRake, force = false) => {
        const res = await api.post(`/sessions/${sessionId}/dealer-shifts/change`, {
            dealer_id: dealerId,
            declared_rake: declaredRake,
            force,
        });
        return res.data;
    },
    endShift: async (sessionId, declaredRake) => {
        const res = await api.post(`/sessions/${sessionId}/dealer-shifts/end`, { declared_rake: declaredRake });
        return res.data;
    },
    // Liquidación: registrar un pago a un dealer (ledger de caja, no toca finanzas)
    createPayout: async (dealerId, { amount, method = null, note = null, period_start = null, period_end = null }) => {
        const res = await api.post(`/dealers/${dealerId}/payouts`, { amount, method, note, period_start, period_end });
        return res.data;
    },
    getPayouts: async (startDate = null, endDate = null, dealerId = null) => {
        const params = new URLSearchParams();
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);
        if (dealerId) params.append('dealer_id', dealerId);
        const res = await api.get(`/dealers/payouts?${params.toString()}`);
        return res.data;
    },
    // Invitar a la app por WhatsApp: genera código de verificación y devuelve el
    // link wa.me para enviarlo al teléfono del dealer.
    invite: async (dealerId, phone, name = null) => {
        const res = await api.post(`/dealers/${dealerId}/invite`, { phone, name });
        return res.data;
    },
    // Resetear acceso de un dealer YA activado (olvidó la contraseña): vuelve la
    // cuenta a pendiente y devuelve un nuevo link wa.me con OTP. No borra historial.
    resetAccess: async (dealerId, phone = null) => {
        const res = await api.post(`/dealers/${dealerId}/reset-access`, { phone });
        return res.data;
    },
};

// --- PORTAL DEL DEALER (autenticado, rol DEALER) ---
export const dealerSelfService = {
    getMyTable: async () => (await api.get('/dealer/my-table')).data,
    toggleBust: async (playerId) => (await api.post('/dealer/my-table/bust', { player_id: playerId })).data,
    sendAlert: async (alertType, message = null) =>
        (await api.post('/dealer/my-table/alert', { alert_type: alertType, message })).data,
    getMyShift: async () => (await api.get('/dealer/my-shift')).data,
    getMyHistory: async (limit = 50) => (await api.get(`/dealer/my-history?limit=${limit}`)).data,
    getMySummary: async () => (await api.get('/dealer/my-summary')).data,
};

// --- USUARIOS (multi-usuario por club) ---
export const userService = {
    list: async () => {
        const res = await api.get('/users/');
        return res.data;
    },
    invite: async ({ email, name, role }) => {
        const res = await api.post('/users/invite', { email, name, role });
        return res.data;
    },
    update: async (userId, { name, role, is_active }) => {
        const payload = {};
        if (name !== undefined) payload.name = name;
        if (role !== undefined) payload.role = role;
        if (is_active !== undefined) payload.is_active = is_active;
        const res = await api.patch(`/users/${userId}`, payload);
        return res.data;
    },
    deactivate: async (userId) => {
        await api.delete(`/users/${userId}`);
    },
    resendInvitation: async (userId) => {
        const res = await api.post(`/users/${userId}/resend-invitation`);
        return res.data;
    },
    acceptInvitation: async ({ token, name, password }) => {
        const res = await api.post('/users/accept-invitation', { token, name, password });
        return res.data;
    },
};

const getAll = async () => {
    // Llamamos al endpoint que acabamos de crear
    const response = await api.get('/stats/history-mixed');
    return response.data;
};

export default {
    getAll,
};


