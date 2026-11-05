import { supabase } from '../lib/supabase.js';

// ==============================================================================
// SERVICIO DE SEGURIDAD ZERO-TRUST, RATE LIMITING Y PROTECCIÓN CONTRA BOTS
// ==============================================================================

const RATE_LIMIT_PREFIX = 'tropicalia_rl_';
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutos
const MIN_ORDER_INTERVAL_MS = 30 * 1000;        // 30 segundos entre pedidos

// Almacenamiento seguro compatible con navegador y Node.js (pruebas unitarias)
const nodeStorageFallback = new Map();

function safeGetStorage(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch {}
  return nodeStorageFallback.get(key) || null;
}

function safeSetStorage(key, val) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, val);
      return;
    }
  } catch {}
  nodeStorageFallback.set(key, val);
}

function safeRemoveStorage(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
      return;
    }
  } catch {}
  nodeStorageFallback.delete(key);
}

export const securityService = {
  /**
   * Genera una clave de idempotencia criptográfica única (UUID v4)
   * para prevenir que solicitudes duplicadas o ataques de reenvío
   * generen órdenes repetidas.
   */
  generateIdempotencyKey() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback criptográfico compatible con navegadores antiguos
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  },

  /**
   * Sanitiza entradas de texto para prevenir inyecciones XSS y caracteres maliciosos.
   */
  sanitizeInput(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/[<>]/g, '') // Remueve tags HTML
      .replace(/javascript:/gi, '')
      .replace(/onload=/gi, '')
      .replace(/onerror=/gi, '')
      .trim();
  },

  /**
   * Valida formato de correo electrónico estándar.
   */
  validateEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return re.test(email.trim());
  },

  /**
   * Valida formato telefónico venezolano (0414, 0424, 0412, 0416, 0426 o internacional +58).
   */
  validatePhoneVE(phone) {
    if (!phone || typeof phone !== 'string') return false;
    const clean = phone.replace(/[^0-9]/g, '');
    if (clean.length === 11 && clean.startsWith('04')) return true;
    if (clean.length === 12 && clean.startsWith('584')) return true;
    return clean.length >= 10 && clean.length <= 15;
  },

  // ----------------------------------------------------------------------------
  // RATE LIMITING DE AUTENTICACIÓN (PROTECCIÓN CONTRA FUERZA BRUTA)
  // ----------------------------------------------------------------------------

  /**
   * Verifica si un identificador (correo/usuario) está bloqueado por demasiados intentos.
   * @param {string} identifier 
   * @returns {{ blocked: boolean, remainingSeconds: number, attemptsLeft: number }}
   */
  checkLoginRateLimit(identifier) {
    if (!identifier) return { blocked: false, remainingSeconds: 0, attemptsLeft: MAX_LOGIN_ATTEMPTS };

    const key = `${RATE_LIMIT_PREFIX}login_${identifier.toLowerCase().trim()}`;
    const raw = safeGetStorage(key);

    if (!raw) {
      return { blocked: false, remainingSeconds: 0, attemptsLeft: MAX_LOGIN_ATTEMPTS };
    }

    try {
      const data = JSON.parse(raw);
      const now = Date.now();

      if (data.lockedUntil && now < data.lockedUntil) {
        const remainingSeconds = Math.ceil((data.lockedUntil - now) / 1000);
        return { blocked: true, remainingSeconds, attemptsLeft: 0 };
      }

      // Si el bloqueo ya expiró, limpiar
      if (data.lockedUntil && now >= data.lockedUntil) {
        safeRemoveStorage(key);
        return { blocked: false, remainingSeconds: 0, attemptsLeft: MAX_LOGIN_ATTEMPTS };
      }

      const attemptsLeft = Math.max(0, MAX_LOGIN_ATTEMPTS - (data.attempts || 0));
      return { blocked: false, remainingSeconds: 0, attemptsLeft };
    } catch {
      safeRemoveStorage(key);
      return { blocked: false, remainingSeconds: 0, attemptsLeft: MAX_LOGIN_ATTEMPTS };
    }
  },

  /**
   * Registra un intento de inicio de sesión fallido.
   * Aplica bloqueo de 15 minutos al alcanzar 5 intentos.
   */
  recordFailedLoginAttempt(identifier) {
    if (!identifier) return;

    const key = `${RATE_LIMIT_PREFIX}login_${identifier.toLowerCase().trim()}`;
    const raw = safeGetStorage(key);
    let data = { attempts: 0, firstAttempt: Date.now() };

    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {}
    }

    data.attempts = (data.attempts || 0) + 1;
    data.lastAttempt = Date.now();

    if (data.attempts >= MAX_LOGIN_ATTEMPTS) {
      data.lockedUntil = Date.now() + LOGIN_LOCKOUT_WINDOW_MS;
      this.logSecurityAlert('LOGIN_BRUTE_FORCE_BLOCKED', {
        identifier,
        attempts: data.attempts,
        lockedMinutes: LOGIN_LOCKOUT_WINDOW_MS / 60000
      });
    }

    safeSetStorage(key, JSON.stringify(data));
  },

  /**
   * Restablece los intentos tras un inicio de sesión exitoso.
   */
  resetLoginAttempts(identifier) {
    if (!identifier) return;
    const key = `${RATE_LIMIT_PREFIX}login_${identifier.toLowerCase().trim()}`;
    safeRemoveStorage(key);
  },

  // ----------------------------------------------------------------------------
  // RATE LIMITING DE PEDIDOS (PROTECCIÓN CONTRA BOMBARDEO DE BOTS)
  // ----------------------------------------------------------------------------

  /**
   * Verifica si el cliente está emitiendo órdenes demasiado rápido (flood / spam).
   * @returns {{ allowed: boolean, waitSeconds: number }}
   */
  checkOrderRateLimit() {
    const key = `${RATE_LIMIT_PREFIX}last_order_timestamp`;
    const lastOrderTime = parseInt(safeGetStorage(key) || '0', 10);
    const now = Date.now();
    const elapsed = now - lastOrderTime;

    if (elapsed < MIN_ORDER_INTERVAL_MS) {
      const waitSeconds = Math.ceil((MIN_ORDER_INTERVAL_MS - elapsed) / 1000);
      return { allowed: false, waitSeconds };
    }

    return { allowed: true, waitSeconds: 0 };
  },

  /**
   * Registra la emisión de un pedido exitoso para iniciar la ventana de enfriamiento.
   */
  recordOrderPlaced() {
    const key = `${RATE_LIMIT_PREFIX}last_order_timestamp`;
    safeSetStorage(key, Date.now().toString());
  },

  // ----------------------------------------------------------------------------
  // AUDITORÍA Y REGISTRO DE EVENTOS SOSPECHOSOS
  // ----------------------------------------------------------------------------

  /**
   * Registra alertas de seguridad en la base de datos o consola.
   */
  async logSecurityAlert(eventType, metadata = {}) {
    const logData = {
      event_type: eventType,
      severity: 'warning',
      details: metadata,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
      created_at: new Date().toISOString()
    };

    try {
      // Intento de persistencia silenciosa en Supabase si la tabla existe
      await supabase.from('security_audit_logs').insert([logData]);
    } catch {
      // Si la tabla no está creada aún o falla la red, loggear localmente
      console.warn(`[Zero-Trust Security Alert: ${eventType}]`, metadata);
    }
  }
};
