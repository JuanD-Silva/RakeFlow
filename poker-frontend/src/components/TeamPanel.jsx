import { useEffect, useState } from 'react';
import {
  UserPlusIcon,
  EnvelopeIcon,
  PaperAirplaneIcon,
  TrashIcon,
  ShieldCheckIcon,
  PencilSquareIcon,
  CheckIcon,
  XMarkIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { userService } from '../api/services';
import { useAuth } from '../context/AuthContext';
import ConfirmModal from './ConfirmModal';

const ROLE_LABELS = {
  owner: 'Dueño',
  manager: 'Encargado',
  cashier: 'Cajero',
};

const ROLE_BADGE = {
  owner: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300',
  manager: 'bg-blue-500/10 border-blue-500/40 text-blue-300',
  cashier: 'bg-gray-700/40 border-gray-600 text-gray-300',
};

export default function TeamPanel() {
  const { canManageUsers, userId: myId } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteData, setInviteData] = useState({ email: '', name: '', role: 'cashier' });
  const [inviting, setInviting] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({ name: '', role: 'cashier' });
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await userService.list();
      setUsers(data);
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || 'No se pudieron cargar los usuarios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteData.email.trim()) return;
    setInviting(true);
    try {
      await userService.invite({
        email: inviteData.email.trim().toLowerCase(),
        name: inviteData.name.trim() || null,
        role: inviteData.role,
      });
      setInviteData({ email: '', name: '', role: 'cashier' });
      setShowInvite(false);
      await load();
    } catch (err) {
      alert(err.response?.data?.detail || 'No se pudo enviar la invitación');
    } finally {
      setInviting(false);
    }
  };

  const startEdit = (u) => {
    setEditingId(u.id);
    setEditData({ name: u.name || '', role: u.role });
  };

  const saveEdit = async (u) => {
    try {
      await userService.update(u.id, {
        name: editData.name,
        role: editData.role,
      });
      setEditingId(null);
      await load();
    } catch (err) {
      alert(err.response?.data?.detail || 'No se pudo actualizar');
    }
  };

  const handleResend = async (u) => {
    try {
      await userService.resendInvitation(u.id);
      await load();
      alert('Invitación reenviada');
    } catch (err) {
      alert(err.response?.data?.detail || 'No se pudo reenviar');
    }
  };

  const handleDeactivate = async () => {
    if (!confirmDelete) return;
    try {
      await userService.deactivate(confirmDelete.id);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      alert(err.response?.data?.detail || 'No se pudo desactivar');
    }
  };

  if (loading) return <div className="text-gray-400 text-center py-10 animate-pulse">Cargando equipo…</div>;
  if (error) return <div className="text-red-400 text-center py-10 bg-red-900/10 rounded-xl border border-red-500/20">{error}</div>;

  return (
    <div className="max-w-4xl mx-auto">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight">Equipo</h2>
          <p className="text-gray-500 text-sm mt-1">Gestiona los usuarios que tienen acceso a tu club.</p>
        </div>
        {canManageUsers && (
          <button
            onClick={() => setShowInvite(!showInvite)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-5 py-2.5 rounded-xl flex items-center gap-2 text-sm uppercase tracking-wider shadow-lg shadow-emerald-900/20"
          >
            <UserPlusIcon className="w-5 h-5" /> Invitar usuario
          </button>
        )}
      </header>

      {showInvite && canManageUsers && (
        <form onSubmit={handleInvite} className="mb-6 bg-gray-900/60 border border-gray-800 rounded-2xl p-5 animate-fade-in">
          <h3 className="text-white font-bold mb-3 flex items-center gap-2">
            <EnvelopeIcon className="w-5 h-5 text-emerald-400" /> Nueva invitación
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="email"
              required
              placeholder="email@persona.com"
              value={inviteData.email}
              onChange={(e) => setInviteData({ ...inviteData, email: e.target.value })}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none text-sm"
            />
            <input
              type="text"
              placeholder="Nombre (opcional)"
              value={inviteData.name}
              onChange={(e) => setInviteData({ ...inviteData, name: e.target.value })}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none text-sm"
            />
            <select
              value={inviteData.role}
              onChange={(e) => setInviteData({ ...inviteData, role: e.target.value })}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none text-sm"
            >
              <option value="cashier">Cajero</option>
              <option value="manager">Encargado</option>
            </select>
          </div>
          <div className="flex gap-2 mt-4">
            <button type="submit" disabled={inviting} className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-lg text-sm font-bold flex items-center gap-2 disabled:opacity-60">
              <PaperAirplaneIcon className="w-4 h-4" /> {inviting ? 'Enviando…' : 'Enviar invitación'}
            </button>
            <button type="button" onClick={() => setShowInvite(false)} className="text-gray-400 hover:text-white px-4 py-2 text-sm">
              Cancelar
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            La persona recibirá un email para crear su contraseña. La invitación expira en 7 días.
          </p>
        </form>
      )}

      <div className="bg-gray-900/40 border border-gray-800 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wider">
              <th className="text-left p-4 font-semibold">Usuario</th>
              <th className="text-left p-4 font-semibold">Rol</th>
              <th className="text-left p-4 font-semibold">Estado</th>
              <th className="text-right p-4 font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {users.map((u) => {
              const isEditing = editingId === u.id;
              const isMe = u.id === myId;
              return (
                <tr key={u.id} className="hover:bg-gray-800/30">
                  <td className="p-4">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editData.name}
                        onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-sm w-full"
                        placeholder="Nombre"
                      />
                    ) : (
                      <div>
                        <div className="text-white font-bold flex items-center gap-2">
                          {u.name || <span className="text-gray-500 italic">Sin nombre</span>}
                          {isMe && <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-1.5 py-0.5 rounded uppercase tracking-wider">Tú</span>}
                        </div>
                        <div className="text-gray-500 text-xs mt-0.5">{u.email}</div>
                      </div>
                    )}
                  </td>
                  <td className="p-4">
                    {isEditing ? (
                      <select
                        value={editData.role}
                        onChange={(e) => setEditData({ ...editData, role: e.target.value })}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-sm"
                        disabled={u.role === 'owner'}
                      >
                        <option value="cashier">Cajero</option>
                        <option value="manager">Encargado</option>
                        {u.role === 'owner' && <option value="owner">Dueño</option>}
                      </select>
                    ) : (
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${ROLE_BADGE[u.role] || ROLE_BADGE.cashier}`}>
                        <ShieldCheckIcon className="w-3 h-3" /> {ROLE_LABELS[u.role] || u.role}
                      </span>
                    )}
                  </td>
                  <td className="p-4">
                    {!u.is_active ? (
                      <span className="text-red-400 text-xs font-bold uppercase tracking-wider">Inactivo</span>
                    ) : u.invitation_pending ? (
                      <span className="text-amber-400 text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                        <ClockIcon className="w-3 h-3" /> Invitación pendiente
                      </span>
                    ) : (
                      <span className="text-emerald-400 text-xs font-bold uppercase tracking-wider">Activo</span>
                    )}
                  </td>
                  <td className="p-4 text-right">
                    {!canManageUsers ? (
                      <span className="text-gray-600 text-xs">—</span>
                    ) : isEditing ? (
                      <div className="flex justify-end gap-2">
                        <button onClick={() => saveEdit(u)} className="text-emerald-400 hover:text-emerald-300 p-1.5" title="Guardar">
                          <CheckIcon className="w-5 h-5" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-gray-500 hover:text-white p-1.5" title="Cancelar">
                          <XMarkIcon className="w-5 h-5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        {u.invitation_pending && (
                          <button onClick={() => handleResend(u)} className="text-blue-400 hover:text-blue-300 p-1.5" title="Reenviar invitación">
                            <PaperAirplaneIcon className="w-5 h-5" />
                          </button>
                        )}
                        {u.role !== 'owner' && (
                          <button onClick={() => startEdit(u)} className="text-gray-400 hover:text-white p-1.5" title="Editar">
                            <PencilSquareIcon className="w-5 h-5" />
                          </button>
                        )}
                        {!isMe && u.role !== 'owner' && u.is_active && (
                          <button onClick={() => setConfirmDelete(u)} className="text-red-400 hover:text-red-300 p-1.5" title="Desactivar">
                            <TrashIcon className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDeactivate}
        title="¿Desactivar usuario?"
        message={`${confirmDelete?.email} dejará de poder iniciar sesión. Su historial y auditoría se conservan.`}
      />
    </div>
  );
}
