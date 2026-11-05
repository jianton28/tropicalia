/**
 * Servicio Centralizado de Redirección para Autenticación (Supabase Auth)
 * Proyecto: Tropicalia Web & Móvil (Vercel / Capacitor)
 * 
 * Garantiza que todas las llamadas de autenticación (signUp, resetPasswordForEmail, 
 * signInWithOAuth, updateUser email, resend) usen la URL oficial de producción en Vercel
 * (o el dominio configurado) y NUNCA fallen apuntando al puerto local localhost:3000
 * ni a puertos de desarrollo de Vite (5173, etc.) o esquemas Capacitor en correos externos.
 */

export const APP_PRODUCTION_URL = 
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SITE_URL)
    ? import.meta.env.VITE_SITE_URL.replace(/\/$/, '')
    : 'https://tropicalia-rho.vercel.app';

/**
 * Determina si un origen corresponde a un entorno local, emulador de desarrollo o contenedor móvil.
 * @param {string} origin
 * @returns {boolean}
 */
export function isLocalOrInternalOrigin(origin) {
  if (!origin || typeof origin !== 'string') return true;
  const o = origin.toLowerCase().trim();

  return (
    o === '' ||
    o.includes('localhost') ||
    o.includes('127.0.0.1') ||
    o.includes('.local') ||
    o.startsWith('capacitor://') ||
    o.startsWith('file://') ||
    o.includes(':3000') ||
    o.includes(':5173') ||
    o.includes(':4173') ||
    o.includes(':8080')
  );
}

/**
 * Construye la URL de redirección oficial y segura para Supabase Auth.
 * 
 * Reglas:
 * 1. Si se ejecuta en navegador bajo un dominio público (ej. https://tropicalia-rho.vercel.app o dominio propio),
 *    utiliza window.location.origin + path.
 * 2. Si se ejecuta en local (localhost:5173, localhost:3000, 127.0.0.1) o en la app móvil (capacitor://localhost),
 *    o en entorno Node/SSR, conmuta OBLIGATORIAMENTE a APP_PRODUCTION_URL (https://tropicalia-rho.vercel.app).
 * 3. Previene estrictamente que los correos de confirmación / restablecimiento apunten a localhost:3000.
 * 
 * @param {string} [path='/portal'] - Ruta de destino tras la autenticación
 * @param {string} [originOverride=null] - Anulación opcional de origen para testing o entornos específicos
 * @returns {string} URL absoluta normalizada
 */
export function getAuthRedirectUrl(path = '/portal', originOverride = null) {
  const cleanPath = path ? (path.startsWith('/') ? path : `/${path}`) : '/portal';

  // Si se pasa un originOverride explícito (usado en tests o configuración personalizada):
  if (originOverride && typeof originOverride === 'string') {
    const trimmed = originOverride.trim().replace(/\/$/, '');
    if (!isLocalOrInternalOrigin(trimmed)) {
      return `${trimmed}${cleanPath}`;
    }
    return `${APP_PRODUCTION_URL}${cleanPath}`;
  }

  // Si nos encontramos en un entorno de navegador con window.location disponible:
  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin.trim().replace(/\/$/, '');
    if (!isLocalOrInternalOrigin(origin)) {
      return `${origin}${cleanPath}`;
    }
  }

  // Fallback definitivo a la URL de producción oficial
  return `${APP_PRODUCTION_URL}${cleanPath}`;
}

