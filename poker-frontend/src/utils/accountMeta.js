// Metadata de rol para el selector de cuentas y el switcher (multi-cuenta).
// El emoji + etiqueta con la que se muestra cada cuenta ("🃏 Jugador · Mambo").
export const ROLE_META = {
  player: { emoji: '🃏', label: 'Jugador' },
  dealer: { emoji: '🎰', label: 'Dealer' },
  owner: { emoji: '🏢', label: 'Dueño' },
  manager: { emoji: '🏢', label: 'Encargado' },
  cashier: { emoji: '🏢', label: 'Cajero' },
};

// A dónde entra cada rol tras elegir/cambiar de cuenta.
export function homeForRole(role) {
  if (role === 'dealer') return '/dealer';
  if (role === 'player') return '/jugador';
  return '/dashboard';
}
