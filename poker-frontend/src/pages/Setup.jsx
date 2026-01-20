// src/pages/Setup.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';

export default function Setup() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  
  // Estados del formulario
  const [goal, setGoal] = useState('');
  const [partners, setPartners] = useState([
    { name: 'Caja Menor', percentage: 10 },
    { name: 'Socio 1', percentage: 45 },
    { name: 'Socio 2', percentage: 45 }
  ]);
  const [totalPercent, setTotalPercent] = useState(100);

  // Calcular suma en tiempo real
  useEffect(() => {
    const sum = partners.reduce((acc, curr) => acc + (parseFloat(curr.percentage) || 0), 0);
    setTotalPercent(sum);
  }, [partners]);

  // Manejadores de la tabla dinámica
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
    
    // Validaciones
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
      window.location.reload();
      
    } catch (error) {
      console.error(error);
      alert("Error guardando configuración: " + (error.response?.data?.detail || error.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4 py-10 animate-fade-in">
      <div className="max-w-2xl w-full bg-gray-800 p-8 rounded-2xl shadow-2xl border border-gray-700">
        
        <div className="text-center mb-8">
          <span className="text-5xl block mb-2">🤝</span>
          <h2 className="text-3xl font-bold text-white">Configuración de Socios</h2>
          <p className="text-gray-400">Define tus gastos fijos y cómo se reparte la utilidad.</p>
        </div>

        <form onSubmit={handleSave} className="space-y-8">
          
          {/* 1. SECCIÓN META MENSUAL */}
          <div className="bg-gray-900/50 p-6 rounded-xl border border-gray-700">
            <label className="block text-blue-400 font-bold uppercase text-xs tracking-wider mb-2">
              1. Gastos Fijos / Meta Mensual (Deuda)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-3 text-gray-500 text-lg">$</span>
              <input
                type="number"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="w-full bg-gray-800 text-white border border-gray-600 rounded-lg p-3 pl-8 focus:border-blue-500 outline-none font-mono text-xl font-bold placeholder-gray-600"
                placeholder="0"
                min="0"
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              * Este monto se descontará primero de las ganancias. Si no tienes, déjalo en 0.
            </p>
          </div>

          {/* 2. SECCIÓN SOCIOS */}
          <div>
            <div className="flex justify-between items-end mb-2">
              <label className="block text-green-400 font-bold uppercase text-xs tracking-wider">
                2. Reparto de Utilidades (Remanente)
              </label>
              <span className={`text-xs font-bold px-2 py-1 rounded ${totalPercent === 100 ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'}`}>
                Suma: {totalPercent}%
              </span>
            </div>

            <div className="bg-gray-900/50 rounded-xl border border-gray-700 overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
                  <tr>
                    <th className="p-3 pl-4">Nombre / Concepto</th>
                    <th className="p-3 w-32 text-center">% Porcentaje</th>
                    <th className="p-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {partners.map((partner, index) => (
                    <tr key={index} className="hover:bg-gray-800/50 transition-colors">
                      <td className="p-3">
                        <input
                          type="text"
                          value={partner.name}
                          onChange={(e) => updatePartner(index, 'name', e.target.value)}
                          placeholder="Ej: Juan Silva"
                          className="w-full bg-transparent text-white outline-none placeholder-gray-600"
                        />
                      </td>
                      <td className="p-3">
                        <div className="relative">
                            <input
                            type="number"
                            value={partner.percentage}
                            onChange={(e) => updatePartner(index, 'percentage', e.target.value)}
                            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-right text-white font-mono focus:border-green-500 outline-none"
                            placeholder="0"
                            />
                            <span className="absolute right-7 top-1 text-gray-500 hidden">%</span>
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        {partners.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removePartner(index)}
                            className="text-gray-500 hover:text-red-400 transition-colors"
                            title="Eliminar"
                          >
                            🗑️
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              <button
                type="button"
                onClick={addPartner}
                className="w-full py-3 text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors border-t border-gray-700 flex items-center justify-center gap-2"
              >
                <span>➕ Agregar Socio</span>
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full font-bold py-4 rounded-xl shadow-lg transform transition-all active:scale-95 text-lg ${
                totalPercent === 100 
                ? 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white'
                : 'bg-gray-700 text-gray-400 cursor-not-allowed'
            }`}
          >
            {loading ? 'Guardando...' : totalPercent === 100 ? '✅ Guardar Configuración' : '⚠️ Ajusta los porcentajes a 100%'}
          </button>

        </form>
      </div>
    </div>
  );
}