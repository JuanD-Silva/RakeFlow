import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { 
  CurrencyDollarIcon, 
  UserGroupIcon, 
  TrashIcon, 
  PlusCircleIcon, 
  CheckBadgeIcon,
  ChartPieIcon
} from '@heroicons/react/24/outline';

export default function Setup() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  
  // Estados del formulario
  const [goal, setGoal] = useState('');
  const [partners, setPartners] = useState([
    { name: 'Caja Menor', percentage: 10 },
    { name: 'Socio Principal', percentage: 90 }
  ]);
  const [totalPercent, setTotalPercent] = useState(100);

  // Calcular suma en tiempo real
  useEffect(() => {
    const sum = partners.reduce((acc, curr) => acc + (parseFloat(curr.percentage) || 0), 0);
    setTotalPercent(sum);
  }, [partners]);

  const addPartner = () => {
    setPartners([...partners, { name: '', percentage: 0 }]);
  };

  const removePartner = (index) => {
    const newPartners = partners.filter((_, i) => i !== index);
    setPartners(newPartners);
  };

  const updatePartner = (index, field, value) => {
    const newPartners = [...partners];
    newPartners[index][field] = value;
    setPartners(newPartners);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    
    if (Math.round(totalPercent) !== 100) {
      alert(`⚠️ Los porcentajes deben sumar exactamente 100%. Actualmente suman: ${totalPercent}%`);
      return;
    }
    if (partners.some(p => p.name.trim() === '')) {
      alert("⚠️ Todos los socios deben tener un nombre.");
      return;
    }

    setLoading(true);
    try {
      const finalGoal = goal === '' ? 0 : parseFloat(goal);

      await api.post('/config/initial-setup', {
        monthly_goal: finalGoal,
        partners: partners.map(p => ({
          name: p.name,
          percentage: parseFloat(p.percentage)
        }))
      });

      navigate('/dashboard');
      
    } catch (error) {
      console.error(error);
      alert("Error guardando configuración: " + (error.response?.data?.detail || error.message));
    } finally {
      setLoading(false);
    }
  };

  // Colores dinámicos para validación
  const isValid = totalPercent === 100;
  const statusColor = isValid ? "text-emerald-400" : "text-rose-400";
  const statusBg = isValid ? "bg-emerald-500" : "bg-rose-500";
  const statusBorder = isValid ? "border-emerald-500/50" : "border-rose-500/50";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-slate-900 to-black px-4 py-10 animate-fade-in font-sans">
      
      {/* Fondo decorativo */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-5%] w-96 h-96 bg-blue-600/20 rounded-full blur-3xl"></div>
        <div className="absolute bottom-[-10%] left-[-5%] w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl"></div>
      </div>

      <div className="relative max-w-2xl w-full bg-gray-900/60 backdrop-blur-xl p-8 rounded-3xl shadow-2xl border border-gray-700/50">
        
        {/* HEADER */}
        <div className="text-center mb-10">
          <div className="mx-auto w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mb-4 border border-blue-500/20 shadow-lg shadow-blue-500/10">
            <CheckBadgeIcon className="w-10 h-10 text-blue-400" />
          </div>
          <h2 className="text-3xl font-black text-white tracking-tight">Configuración Inicial</h2>
          <p className="text-gray-400 mt-2 text-sm">Define la estructura financiera de tu club.</p>
        </div>

        <form onSubmit={handleSave} className="space-y-8">
          
          {/* 1. SECCIÓN META MENSUAL */}
          <div className="group bg-black/40 p-6 rounded-2xl border border-gray-700 hover:border-blue-500/30 transition-all">
            <label className="flex items-center gap-2 text-blue-400 font-bold uppercase text-xs tracking-widest mb-4">
              <CurrencyDollarIcon className="w-4 h-4" />
              1. Meta Mensual (Gastos Fijos)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-2xl font-light">$</span>
              <input
                type="number"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="w-full bg-gray-800/50 text-white border border-gray-600 rounded-xl py-4 pl-10 pr-4 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none font-mono text-3xl font-bold placeholder-gray-600 transition-all"
                placeholder="0"
                min="0"
              />
            </div>
            <p className="text-[10px] text-gray-500 mt-3 pl-1">
              * Este monto se paga primero (prioridad alta) antes de repartir a socios.
            </p>
          </div>

          {/* 2. SECCIÓN SOCIOS */}
          <div>
            <div className="flex justify-between items-end mb-3 px-1">
              <label className="flex items-center gap-2 text-emerald-400 font-bold uppercase text-xs tracking-widest">
                <ChartPieIcon className="w-4 h-4" />
                2. Distribución de Utilidades
              </label>
              <span className={`text-xs font-black font-mono px-3 py-1 rounded-full border ${statusBorder} bg-opacity-10 ${statusColor} bg-white/5`}>
                TOTAL: {totalPercent}%
              </span>
            </div>

            {/* BARRA DE PROGRESO */}
            <div className="h-2 w-full bg-gray-800 rounded-full mb-6 overflow-hidden">
                <div 
                    className={`h-full transition-all duration-500 ease-out ${statusBg}`} 
                    style={{ width: `${Math.min(totalPercent, 100)}%` }}
                ></div>
            </div>

            <div className="space-y-3">
                {/* Cabecera de columnas visual */}
                <div className="grid grid-cols-12 gap-4 px-4 text-[10px] uppercase text-gray-500 font-bold tracking-wider">
                    <div className="col-span-7">Nombre del Socio</div>
                    <div className="col-span-4 text-center">% Participación</div>
                    <div className="col-span-1"></div>
                </div>

                {partners.map((partner, index) => (
                  <div key={index} className="grid grid-cols-12 gap-4 items-center bg-gray-800/40 p-3 rounded-xl border border-gray-700/50 hover:bg-gray-800 hover:border-gray-600 transition-all group">
                    
                    {/* Input Nombre */}
                    <div className="col-span-7 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gray-700 flex items-center justify-center text-gray-400">
                            <UserGroupIcon className="w-4 h-4" />
                        </div>
                        <input
                          type="text"
                          value={partner.name}
                          onChange={(e) => updatePartner(index, 'name', e.target.value)}
                          placeholder="Nombre del socio"
                          className="w-full bg-transparent text-white text-sm font-medium outline-none placeholder-gray-600 border-b border-transparent focus:border-blue-500/50 pb-0.5 transition-colors"
                        />
                    </div>

                    {/* Input Porcentaje */}
                    <div className="col-span-4 relative">
                        <input
                          type="number"
                          value={partner.percentage}
                          onChange={(e) => updatePartner(index, 'percentage', e.target.value)}
                          className="w-full bg-black/20 border border-gray-600 rounded-lg py-2 px-3 text-right text-white font-mono text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 outline-none transition-all"
                          placeholder="0"
                        />
                        <span className="absolute right-8 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none">%</span>
                    </div>

                    {/* Botón Eliminar */}
                    <div className="col-span-1 flex justify-end">
                      {partners.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePartner(index)}
                          className="p-2 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addPartner}
                  className="w-full py-3 mt-2 rounded-xl border border-dashed border-gray-600 text-gray-500 hover:text-blue-400 hover:border-blue-500/50 hover:bg-blue-500/5 transition-all text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2"
                >
                  <PlusCircleIcon className="w-5 h-5" />
                  Agregar Nuevo Socio
                </button>
            </div>
          </div>

          {/* BOTÓN SUBMIT */}
          <div className="pt-4">
            <button
                type="submit"
                disabled={loading || !isValid}
                className={`w-full py-4 rounded-xl shadow-xl transform transition-all active:scale-[0.98] font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-3 ${
                isValid 
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-emerald-900/20'
                    : 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'
                }`}
            >
                {loading ? (
                    <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        Guardando...
                    </>
                ) : isValid ? (
                    <>
                        <CheckBadgeIcon className="w-6 h-6" />
                        Confirmar y Finalizar
                    </>
                ) : (
                    `⚠️ Ajusta el total a 100% (${totalPercent}%)`
                )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}