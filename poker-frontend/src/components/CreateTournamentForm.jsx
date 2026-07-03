import { useState, useEffect } from 'react';
import { ChartPieIcon, ClockIcon, BanknotesIcon, TrophyIcon, ArrowLeftIcon, ArrowRightIcon, CheckIcon } from '@heroicons/react/24/solid';
import BlindStructureEditor, { DEFAULT_BLINDS } from './BlindStructureEditor';

const STEPS = [
    { n: 1, label: 'Básico', icon: TrophyIcon },
    { n: 2, label: 'Costos', icon: BanknotesIcon },
    { n: 3, label: 'Reloj', icon: ClockIcon },
    { n: 4, label: 'Premios', icon: ChartPieIcon },
];

// Deja SOLO dígitos (bloquea letras, e/E, signos, pegado con texto). Se usa
// type="text" + inputMode="numeric" porque type="number" en Firefox/móvil deja
// escribir letras (el navegador las muestra y el valor llega vacío → se creaba
// el torneo con 0 en silencio).
const digitsOnly = (s) => String(s ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');

// Evento sintético con el valor saneado (los setters solo leen e.target.value).
const cleanEvt = (e) => ({ target: { value: digitsOnly(e.target.value) } });

// Input numérico con prefijo $ reutilizable
function MoneyInput({ value, onChange, accent = 'gray' }) {
    const ring = {
        blue: 'focus:border-blue-500', orange: 'focus:border-orange-500',
        violet: 'focus:border-violet-500', gray: 'focus:border-violet-500',
    }[accent];
    return (
        <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
            <input type="text" inputMode="numeric" placeholder="0" value={value} onChange={(e) => onChange(cleanEvt(e))}
                className={`w-full bg-gray-800 border border-gray-600 ${ring} rounded-lg p-2.5 pl-7 text-white text-base font-mono outline-none transition-colors`} />
        </div>
    );
}

// Input de fichas (puntos al stack) — prefijo "fichas"
function ChipsInput({ value, onChange, placeholder = '0' }) {
    return (
        <div className="relative mt-1.5">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] text-gray-500 uppercase font-bold tracking-wide">fichas</span>
            <input type="text" inputMode="numeric" placeholder={placeholder} value={value} onChange={(e) => onChange(cleanEvt(e))}
                className="w-full bg-gray-900/60 border border-gray-700 focus:border-violet-500 rounded-lg p-2 pl-12 text-white text-sm font-mono outline-none transition-colors" />
        </div>
    );
}

export default function CreateTournamentForm({ onSuccess, onCancel }) {
    const [step, setStep] = useState(1);
    const [name, setName] = useState("");
    const [nameError, setNameError] = useState("");
    const [loading, setLoading] = useState(false);

    // Estructura de blinds + stack inicial (T4)
    const [blinds, setBlinds] = useState(DEFAULT_BLINDS);
    const [startingStack, setStartingStack] = useState(0);
    // Ventanas de rebuy/addon (T4): hasta qué nivel están disponibles (vacío = sin límite)
    const [rebuyUntil, setRebuyUntil] = useState('');
    const [addonUntil, setAddonUntil] = useState('');
    // Programación (T4): fecha/hora de inicio. Vacío = arranca ahora (en juego).
    const [scheduledStart, setScheduledStart] = useState('');

    const [costs, setCosts] = useState({
        buyin: 0, tip: 0, rebuy: 0, doubleRebuy: 0, addon: 0, doubleAddon: 0,
        // fichas (puntos) que suma cada jugada al stack
        tipChips: 0, rebuyChips: 0, doubleRebuyChips: 0, addonChips: 0, doubleAddonChips: 0,
    });
    const [rake, setRake] = useState(10);
    const [placesPaid, setPlacesPaid] = useState(3);
    const [payouts, setPayouts] = useState([50, 30, 20]);

    useEffect(() => {
        const newPayouts = [...payouts];
        if (placesPaid > newPayouts.length) {
            for (let i = newPayouts.length; i < placesPaid; i++) newPayouts.push(0);
        } else if (placesPaid < newPayouts.length) {
            newPayouts.length = placesPaid;
        }
        setPayouts(newPayouts);
    }, [placesPaid]);

    // Validación de payouts: valor derivado (sin estado ni efecto).
    const payoutTotal = payouts.reduce((a, b) => Number(a) + Number(b), 0);
    const payoutError = payoutTotal !== 100 ? `La suma es ${payoutTotal}% (debe ser 100%)` : "";

    const handlePayoutChange = (index, value) => {
        const newArr = [...payouts];
        newArr[index] = Number(value);
        setPayouts(newArr);
    };

    const setCost = (key) => (e) => setCosts({ ...costs, [key]: e.target.value });

    const goNext = () => {
        if (step === 1 && !name.trim()) { setNameError("Ponele un nombre al torneo."); return; }
        setNameError("");
        setStep((s) => Math.min(STEPS.length, s + 1));
    };
    const goBack = () => setStep((s) => Math.max(1, s - 1));

    const handleSubmit = async (e) => {
        e.preventDefault();
        // En pasos previos, Enter avanza en vez de crear.
        if (step < STEPS.length) { goNext(); return; }
        if (!name.trim()) { setStep(1); setNameError("Ponele un nombre al torneo."); return; }
        if (payoutError) return;

        setLoading(true);
        const formData = {
            name,
            buyin_amount: Number(costs.buyin),
            dealer_tip_amount: Number(costs.tip),
            rebuy_price: Number(costs.rebuy),
            double_rebuy_price: Number(costs.doubleRebuy),
            addon_price: Number(costs.addon),
            double_addon_price: Number(costs.doubleAddon),
            rake_percentage: Number(rake),
            payout_structure: payouts,
            bounty_amount: 0,
            blind_structure: blinds,
            starting_stack: Number(startingStack) || 0,
            rebuy_chips: Number(costs.rebuyChips) || 0,
            double_rebuy_chips: Number(costs.doubleRebuyChips) || 0,
            addon_chips: Number(costs.addonChips) || 0,
            double_addon_chips: Number(costs.doubleAddonChips) || 0,
            tip_chips: Number(costs.tipChips) || 0,
            rebuy_until_level: rebuyUntil ? Number(rebuyUntil) : null,
            addon_until_level: addonUntil ? Number(addonUntil) : null,
            scheduled_start: scheduledStart || null,
        };
        try {
            await onSuccess(formData);
        } catch (error) {
            console.error(error);
            setLoading(false);
        }
    };

    const isLast = step === STEPS.length;

    return (
        <div className="relative flex flex-col max-h-[80vh]">
            {loading && <GlobalLoader />}

            {/* Indicador de pasos */}
            <div className="flex items-center mb-4 shrink-0">
                {STEPS.map((s, i) => {
                    const done = step > s.n, active = step === s.n;
                    const Icon = s.icon;
                    return (
                        <div key={s.n} className="flex items-center flex-1 last:flex-none">
                            <button type="button" onClick={() => s.n < step && setStep(s.n)}
                                className={`flex items-center gap-1.5 ${s.n < step ? 'cursor-pointer' : 'cursor-default'}`}>
                                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black border transition-colors ${
                                    active ? 'bg-violet-600 border-violet-500 text-white shadow-lg shadow-violet-900/30'
                                    : done ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-400'
                                    : 'border-gray-700 text-gray-600'}`}>
                                    {done ? <CheckIcon className="w-4 h-4" /> : <Icon className="w-3.5 h-3.5" />}
                                </span>
                                <span className={`text-[10px] font-bold uppercase tracking-wider hidden sm:inline ${active ? 'text-violet-300' : done ? 'text-emerald-400' : 'text-gray-600'}`}>{s.label}</span>
                            </button>
                            {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 mx-2 rounded-full ${done ? 'bg-emerald-500/40' : 'bg-gray-700'}`} />}
                        </div>
                    );
                })}
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1 overflow-hidden">

              {/* Contenido del paso — ÚNICO que scrollea (el footer queda fijo abajo) */}
              <div className="overflow-y-auto pr-1 -mr-1 flex-1 min-h-0">

                {/* PASO 1 — BÁSICO */}
                {step === 1 && (
                    <div className="space-y-4 animate-fade-in">
                        <div>
                            <label className="block text-gray-400 text-sm font-bold mb-1.5">Nombre del evento</label>
                            <input type="text" autoFocus value={name}
                                onChange={(e) => { setName(e.target.value); if (nameError) setNameError(""); }}
                                className={`w-full bg-gray-900 border rounded-lg p-3 text-white outline-none focus:border-violet-500 ${nameError ? 'border-red-500' : 'border-gray-700'}`}
                                placeholder="Ej: Torneo Jueves Express" />
                            {nameError && <p className="text-red-400 text-xs mt-1.5 font-bold">{nameError}</p>}
                        </div>
                        <div>
                            <label className="block text-gray-400 text-sm font-bold mb-1.5">📅 Programar para <span className="text-gray-600 font-normal">(opcional)</span></label>
                            <input type="datetime-local" value={scheduledStart} onChange={(e) => setScheduledStart(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-violet-500 outline-none" />
                            <p className="text-[11px] text-gray-600 mt-1.5">Vacío = arranca ahora. Con fecha = queda en "Programados" hasta que lo abras.</p>
                        </div>
                    </div>
                )}

                {/* PASO 2 — COSTOS */}
                {step === 2 && (
                    <div className="space-y-4 animate-fade-in">
                        {/* BUY-IN — precio + fichas (las fichas son el stack inicial) */}
                        <div>
                            <label className="block text-green-400 text-[10px] font-bold uppercase mb-1">Buy-in · precio + fichas</label>
                            <div className="grid grid-cols-2 gap-3">
                                <MoneyInput value={costs.buyin} onChange={setCost('buyin')} />
                                <ChipsInput value={startingStack} onChange={(e) => setStartingStack(e.target.value)} placeholder="Ej: 20000" />
                            </div>
                            <p className="text-[10px] text-gray-600 mt-1 ml-1">Las fichas del buy-in son el stack inicial de cada jugador.</p>
                        </div>

                        {/* TIP */}
                        <div>
                            <label className="block text-yellow-500 text-[10px] font-bold uppercase mb-1">Tip (staff)</label>
                            <div className="grid grid-cols-2 gap-3">
                                <MoneyInput value={costs.tip} onChange={setCost('tip')} />
                                <ChipsInput value={costs.tipChips} onChange={setCost('tipChips')} />
                            </div>
                        </div>

                        {/* REBUYS — precio + fichas por jugada */}
                        <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50 space-y-3">
                            <label className="text-blue-400 text-xs font-bold uppercase tracking-wider block border-b border-blue-500/20 pb-1">Recompras (Rebuys) · precio + fichas</label>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <span className="block text-[10px] text-blue-300/80 font-bold mb-1 ml-1 uppercase">Sencillo</span>
                                    <MoneyInput value={costs.rebuy} onChange={setCost('rebuy')} accent="blue" />
                                    <ChipsInput value={costs.rebuyChips} onChange={setCost('rebuyChips')} />
                                </div>
                                <div>
                                    <span className="block text-[10px] text-blue-100 font-black mb-1 ml-1 uppercase">Doble</span>
                                    <MoneyInput value={costs.doubleRebuy} onChange={setCost('doubleRebuy')} accent="blue" />
                                    <ChipsInput value={costs.doubleRebuyChips} onChange={setCost('doubleRebuyChips')} />
                                </div>
                            </div>
                            <div className="flex items-center gap-2 px-1">
                                <span className="text-[10px] text-blue-300/70 font-bold uppercase">Disponible hasta nivel</span>
                                <input type="text" inputMode="numeric" placeholder="∞" value={rebuyUntil} onChange={(e) => setRebuyUntil(digitsOnly(e.target.value))}
                                    className="w-16 bg-gray-800 border border-gray-600 focus:border-blue-500 rounded p-1 text-center text-white text-sm font-mono outline-none" />
                                <span className="text-[10px] text-gray-600">(vacío = sin límite)</span>
                            </div>
                        </div>

                        {/* ADD-ONS — precio + fichas por jugada */}
                        <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50 space-y-3">
                            <label className="text-orange-400 text-xs font-bold uppercase tracking-wider block border-b border-orange-500/20 pb-1">Add-ons · precio + fichas</label>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <span className="block text-[10px] text-orange-300/80 font-bold mb-1 ml-1 uppercase">Sencillo</span>
                                    <MoneyInput value={costs.addon} onChange={setCost('addon')} accent="orange" />
                                    <ChipsInput value={costs.addonChips} onChange={setCost('addonChips')} />
                                </div>
                                <div>
                                    <span className="block text-[10px] text-orange-100 font-black mb-1 ml-1 uppercase">Doble</span>
                                    <MoneyInput value={costs.doubleAddon} onChange={setCost('doubleAddon')} accent="orange" />
                                    <ChipsInput value={costs.doubleAddonChips} onChange={setCost('doubleAddonChips')} />
                                </div>
                            </div>
                            <div className="flex items-center gap-2 px-1">
                                <span className="text-[10px] text-orange-300/70 font-bold uppercase">Disponible hasta nivel</span>
                                <input type="text" inputMode="numeric" placeholder="∞" value={addonUntil} onChange={(e) => setAddonUntil(digitsOnly(e.target.value))}
                                    className="w-16 bg-gray-800 border border-gray-600 focus:border-orange-500 rounded p-1 text-center text-white text-sm font-mono outline-none" />
                                <span className="text-[10px] text-gray-600">(vacío = sin límite)</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* PASO 3 — RELOJ */}
                {step === 3 && (
                    <div className="space-y-4 animate-fade-in">
                        <div>
                            <p className="text-white text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2"><ClockIcon className="w-4 h-4 text-violet-400" /> Estructura de blinds</p>
                            <BlindStructureEditor
                                value={blinds} onChange={setBlinds}
                                startingStack={Number(startingStack) || 0}
                                onLoadTemplate={(tpl) => { if (tpl.starting_stack != null) setStartingStack(tpl.starting_stack); }}
                            />
                            <p className="text-[10px] text-gray-600 mt-2">Stack inicial: <span className="text-violet-300 font-bold font-mono">{Number(startingStack) || 0}</span> fichas (se define en el buy-in, paso Costos). Cargar una plantilla también lo ajusta.</p>
                        </div>
                    </div>
                )}

                {/* PASO 4 — PREMIOS */}
                {step === 4 && (
                    <div className="space-y-4 animate-fade-in">
                        {/* RAKE DE LA CASA */}
                        <div className="bg-gray-800 p-4 rounded-lg border border-gray-600">
                            <label className="block text-violet-400 text-[10px] font-bold uppercase mb-1">Rake de la casa (%)</label>
                            <div className="relative">
                                <input type="text" inputMode="numeric" value={rake}
                                    onChange={(e) => { const v = digitsOnly(e.target.value); setRake(v === '' ? '' : Math.min(100, parseInt(v, 10))); }}
                                    className="w-full bg-gray-900 border border-violet-500/50 rounded-lg p-2.5 text-white font-bold outline-none focus:border-violet-400" />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                            </div>
                            <p className="text-[10px] text-gray-600 mt-1">Lo que la casa retiene del pozo antes de repartir premios.</p>
                        </div>

                        <div className="bg-gray-800 p-4 rounded-lg border border-gray-600">
                            <div className="flex justify-between items-center mb-3">
                                <h4 className="text-white text-xs font-bold uppercase flex items-center gap-2"><ChartPieIcon className="w-4 h-4 text-pink-500" /> Distribución de premios</h4>
                                <div className="flex items-center gap-2">
                                    <label className="text-[10px] text-gray-400 uppercase">Puestos pagos:</label>
                                    <input type="text" inputMode="numeric" value={placesPaid}
                                        onChange={(e) => { const v = digitsOnly(e.target.value); setPlacesPaid(v === '' ? 1 : Math.min(20, Math.max(1, parseInt(v, 10)))); }}
                                        className="w-12 bg-gray-900 border border-gray-600 rounded p-1 text-center text-white text-xs font-bold" />
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                {payouts.map((percent, index) => (
                                    <div key={index} className="relative">
                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 font-bold">#{index + 1}</span>
                                        <input type="text" inputMode="numeric" value={percent} onChange={(e) => handlePayoutChange(index, digitsOnly(e.target.value))}
                                            className={`w-full bg-gray-900 border rounded p-1.5 pl-6 text-white text-sm font-mono text-center outline-none focus:border-pink-500 ${payoutError ? 'border-red-500' : 'border-gray-600'}`} />
                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-500">%</span>
                                    </div>
                                ))}
                            </div>
                            {payoutError
                                ? <p className="text-red-400 text-xs mt-2 font-bold text-center">{payoutError}</p>
                                : <p className="text-green-500 text-[10px] mt-2 text-center">✅ Distribución correcta (100%)</p>}
                        </div>
                    </div>
                )}
              </div>

                {/* NAVEGACIÓN — fuera del scroll, posición fija abajo del modal en todos
                    los pasos (evita que el botón salte al cambiar de paso). */}
                <div className="flex gap-3 pt-4 mt-2 border-t border-gray-700/50 shrink-0">
                    <button type="button" onClick={step === 1 ? onCancel : goBack}
                        className="flex items-center justify-center gap-1.5 px-4 py-3 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg font-bold text-sm">
                        <ArrowLeftIcon className="w-4 h-4" /> {step === 1 ? 'Cancelar' : 'Atrás'}
                    </button>
                    {/* `key` distinta en cada botón: fuerza a React a desmontar el de
                        "Siguiente" y montar uno nuevo para "Crear Torneo" en vez de
                        reusar el mismo nodo. Si reusa el nodo y solo le cambia el
                        type de "button" a "submit" durante goNext, la acción por
                        defecto del MISMO click envía el form y crea el torneo
                        saltándose el paso Premios. */}
                    {isLast ? (
                        <button key="submit-create" type="submit" disabled={!!payoutError}
                            className="flex-1 flex items-center justify-center gap-2 py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg font-bold shadow-lg shadow-violet-900/20">
                            <CheckIcon className="w-5 h-5" /> {scheduledStart ? 'Programar Torneo' : 'Crear Torneo'}
                        </button>
                    ) : (
                        <button key="next-step" type="button" onClick={goNext}
                            className="flex-1 flex items-center justify-center gap-2 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-bold shadow-lg shadow-violet-900/20">
                            Siguiente <ArrowRightIcon className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </form>
        </div>
    );
}

// --- GLOBAL LOADER ---
function GlobalLoader() {
    return (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-[150] flex flex-col items-center justify-center animate-fade-in rounded-lg">
            <div className="bg-gray-900/90 p-6 rounded-2xl border border-violet-500/30 flex flex-col items-center shadow-2xl">
                <div className="relative w-12 h-12 mb-3">
                    <div className="absolute inset-0 border-4 border-gray-700 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-violet-500 rounded-full border-t-transparent animate-spin"></div>
                </div>
                <p className="text-violet-200 font-bold text-sm animate-pulse">Creando Torneo...</p>
            </div>
        </div>
    );
}
