import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { supabase } from '../lib/supabase';
import { addressService } from '../services/addressService';
import { favoritesService } from '../services/favoritesService';
import { formatUsd, formatBs, toBs } from '../services/bcvService';
import { getProductImageUrl } from '../services/imageService';
import PasswordInput from '../components/common/PasswordInput';
import MapAddressPicker from '../components/common/MapAddressPicker';
import SecurityVerification from '../components/common/SecurityVerification';
import { securityService } from '../services/securityService';

export default function Portal() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    user,
    role,
    signIn,
    signOut,
    updateUserProfile,
    requestPasswordChange,
    applyPendingPasswordUpdate
  } = useAuth();
  const { addItem } = useCart();

  // Estados de inicio de sesión si no está autenticado
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successBanner, setSuccessBanner] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAuthForm, setShowAuthForm] = useState(!user);
  const [botVerified, setBotVerified] = useState(false);

  // Modales de información Figma: 'pedidos' | 'favoritos' | 'direcciones' | 'datos' | 'clave' | 'pagos' | 'soporte' | null
  const [modalType, setModalType] = useState(null);

  // 1. HISTORIAL DE PEDIDOS
  const [historialOrdenes, setHistorialOrdenes] = useState([]);
  const [loadingHistorial, setLoadingHistorial] = useState(false);
  const [ultimaOrdenId, setUltimaOrdenId] = useState(null);

  // 2. PLATOS FAVORITOS
  const [platosFavoritos, setPlatosFavoritos] = useState([]);
  const [loadingFavoritos, setLoadingFavoritos] = useState(false);

  // 3. DIRECCIONES MÚLTIPLES
  const [direcciones, setDirecciones] = useState([]);
  const [showAddAddressForm, setShowAddAddressForm] = useState(false);
  const [newAddrAlias, setNewAddrAlias] = useState('');
  const [newAddrEsTercero, setNewAddrEsTercero] = useState(false);
  const [newAddrRecipientName, setNewAddrRecipientName] = useState('');
  const [newAddrRecipientPhone, setNewAddrRecipientPhone] = useState('');
  const [newAddrText, setNewAddrText] = useState('');
  const [newAddrCoords, setNewAddrCoords] = useState({ lat: 10.4950, lng: -66.8480 });
  const [newAddrIsDefault, setNewAddrIsDefault] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);

  // 4. DATOS PERSONALES & SEGURIDAD DE CONTRASEÑA
  const [editNombre, setEditNombre] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [currentPwdForProfile, setCurrentPwdForProfile] = useState('');
  const [profileFeedback, setProfileFeedback] = useState('');
  const [profileSubmitting, setProfileSubmitting] = useState(false);

  // Formulario cambio de clave seguro
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdFeedback, setPwdFeedback] = useState('');
  const [pwdSubmitting, setPwdSubmitting] = useState(false);

  // Detectar confirmación automática de contraseña por correo
  useEffect(() => {
    if (searchParams.get('verify_pwd_update') === '1') {
      applyPendingPasswordUpdate()
        .then((ok) => {
          if (ok) {
            setSuccessBanner('🎉 ¡Tu contraseña ha sido confirmada y actualizada exitosamente en Supabase!');
          }
        })
        .catch((err) => {
          setErrorMsg('Error al aplicar nueva contraseña: ' + err.message);
        });
    }

    const lastId = localStorage.getItem('tropicalia_last_order_id');
    if (lastId) {
      supabase
        .from('orders')
        .select('status')
        .eq('id', lastId)
        .maybeSingle()
        .then(({ data }) => {
          if (data && !['delivered', 'cancelled', 'rejected'].includes(data.status)) {
            setUltimaOrdenId(lastId);
          } else {
            localStorage.removeItem('tropicalia_last_order_id');
            setUltimaOrdenId(null);
          }
        });
    }

    // Cargar direcciones
    const addrs = addressService.getAddresses();
    setDirecciones(addrs);
    if (user?.id) {
      addressService.syncWithSupabase(user.id).then(res => setDirecciones(res));
      favoritesService.syncWithSupabase(user.id);
    }
  }, [searchParams, user]);

  useEffect(() => {
    if (user) {
      setEditNombre(user.user_metadata?.full_name || '');
      setEditEmail(user.email || '');
      setEditPhone(user.user_metadata?.phone || '');
    }
  }, [user]);

  // Cargar historial de compras anteriores
  async function cargarHistorial() {
    setLoadingHistorial(true);
    try {
      let query = supabase
        .from('orders')
        .select('*, businesses(name, phone)')
        .order('created_at', { ascending: false });

      const phone = user?.user_metadata?.phone;
      const nombre = user?.user_metadata?.full_name;

      if (phone) {
        query = query.eq('customer_phone', phone);
      } else if (nombre) {
        query = query.eq('customer_name', nombre);
      } else {
        query = query.limit(20);
      }

      const { data, error } = await query;
      if (!error && data) {
        setHistorialOrdenes(data);
      }
    } catch (e) {
      console.warn('Error cargando historial:', e);
    } finally {
      setLoadingHistorial(false);
    }
  }

  // Cargar platos favoritos
  async function cargarPlatosFavoritos() {
    setLoadingFavoritos(true);
    try {
      const favIds = favoritesService.getFavorites();
      if (favIds.length === 0) {
        setPlatosFavoritos([]);
        setLoadingFavoritos(false);
        return;
      }

      const { data, error } = await supabase
        .from('products')
        .select('*, businesses(id, name, lat, lng)')
        .in('id', favIds)
        .eq('is_available', true);

      if (!error && data) {
        setPlatosFavoritos(data);
      }
    } catch (e) {
      console.warn('Error cargando favoritos:', e);
    } finally {
      setLoadingFavoritos(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setErrorMsg('');

    const cleanEmail = securityService.sanitizeInput(email);

    // 1. Verificación de Rate Limiting (Protección contra fuerza bruta)
    const rlCheck = securityService.checkLoginRateLimit(cleanEmail);
    if (rlCheck.blocked) {
      setErrorMsg(`⛔ Has superado el límite de intentos permitidos. Por seguridad, tu acceso está temporalmente pausado. Intenta de nuevo en ${rlCheck.remainingSeconds} segundos.`);
      return;
    }

    // 2. Verificación Anti-Bot / Turnstile
    if (!botVerified) {
      setErrorMsg('⚠️ Por favor completa la verificación de seguridad anti-bot antes de ingresar.');
      return;
    }

    setLoading(true);

    try {
      const res = await signIn(cleanEmail, password);
      securityService.resetLoginAttempts(cleanEmail);
      setLoading(false);
      setShowAuthForm(false);
      if (res.role === 'restaurant') navigate('/cocina');
      else if (res.role === 'delivery') navigate('/delivery');
      else if (res.role === 'admin') navigate('/admin');
    } catch (err) {
      securityService.recordFailedLoginAttempt(cleanEmail);
      const postCheck = securityService.checkLoginRateLimit(cleanEmail);
      if (postCheck.blocked) {
        setErrorMsg('⛔ 5 intentos fallidos alcanzados. Acceso bloqueado por 15 minutos para prevenir ataques de fuerza bruta.');
      } else {
        setErrorMsg(`Credenciales inválidas: ${err.message}. Intentos restantes: ${postCheck.attemptsLeft}`);
      }
      setLoading(false);
    }
  }

  // Guardar nueva dirección (incluye envíos a terceros y coordenadas de mapa)
  async function handleCrearDireccion(e) {
    e.preventDefault();
    if (!newAddrText.trim()) return;

    setSavingAddress(true);
    try {
      const record = {
        alias: newAddrAlias.trim() || (newAddrEsTercero ? `Envío a ${newAddrRecipientName || 'Tercero'}` : 'Mi Dirección'),
        esTercero: newAddrEsTercero,
        recipientName: newAddrEsTercero ? newAddrRecipientName.trim() : '',
        recipientPhone: newAddrEsTercero ? newAddrRecipientPhone.trim() : '',
        address: newAddrText.trim(),
        lat: newAddrCoords.lat,
        lng: newAddrCoords.lng,
        isDefault: newAddrIsDefault
      };

      await addressService.saveAddress(record, user?.id);
      const list = addressService.getAddresses();
      setDirecciones(list);
      setShowAddAddressForm(false);
      setNewAddrAlias('');
      setNewAddrText('');
      setNewAddrEsTercero(false);
      setNewAddrRecipientName('');
      setNewAddrRecipientPhone('');
      alert('✅ Dirección registrada exitosamente.');
    } catch (err) {
      alert('Error guardando dirección: ' + err.message);
    } finally {
      setSavingAddress(false);
    }
  }

  // Actualizar datos personales
  async function handleGuardarDatosPersonales(e) {
    e.preventDefault();
    setProfileFeedback('');
    setProfileSubmitting(true);

    try {
      await updateUserProfile({
        fullName: editNombre,
        email: editEmail,
        phone: editPhone,
        currentPassword: currentPwdForProfile
      });

      setProfileFeedback('✅ Datos actualizados exitosamente. Si modificaste tu correo, revisa tu bandeja de entrada para confirmarlo.');
      setCurrentPwdForProfile('');
    } catch (err) {
      setProfileFeedback('❌ Error: ' + err.message);
    } finally {
      setProfileSubmitting(false);
    }
  }

  // Solicitar cambio seguro de contraseña
  async function handleSolicitarCambioClave(e) {
    e.preventDefault();
    setPwdFeedback('');
    setPwdSubmitting(true);

    try {
      const res = await requestPasswordChange({
        currentPassword: currentPwd,
        newPassword: newPwd,
        confirmPassword: confirmPwd
      });

      setPwdFeedback(`✅ ${res.message}`);
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
    } catch (err) {
      setPwdFeedback('❌ ' + err.message);
    } finally {
      setPwdSubmitting(false);
    }
  }

  // Repetir pedido
  function handleRepetirPedido(ord) {
    if (!ord || !Array.isArray(ord.items)) return;
    const bId = ord.business_id;
    const bName = ord.businesses?.name || 'Tropicalia';

    ord.items.forEach(it => {
      addItem(
        {
          id: it.product_id || it.id,
          name: it.name,
          price: parseFloat(it.price || 0),
          image_url: it.image_url,
          quantity: it.quantity || 1
        },
        bId,
        bName
      );
    });

    setModalType(null);
    navigate('/checkout');
  }

  const nombreMostrar = user?.user_metadata?.full_name || (user ? 'Cliente Tropicalia' : 'Invitado');
  const inicial = nombreMostrar.charAt(0).toUpperCase();

  return (
    <div style={{ position: 'relative', minHeight: '100vh', backgroundColor: '#ffffff', paddingBottom: '90px' }}>
      
      {/* HEADER CURVADO FIGMA 'USER' */}
      <header className="figma-header" style={{ textAlign: 'center', padding: '36px 20px 28px 20px' }}>
        <div style={{
          width: '76px',
          height: '76px',
          backgroundColor: '#ffffff',
          color: 'var(--dark-amaranth)',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '2rem',
          fontWeight: 900,
          margin: '0 auto 12px auto',
          boxShadow: '0 6px 18px rgba(0, 0, 0, 0.2)'
        }}>
          {user ? inicial : '👤'}
        </div>

        <h1 style={{ fontSize: '1.45rem', margin: '0 0 4px 0', color: '#ffffff' }}>
          {nombreMostrar}
        </h1>

        <p style={{ margin: 0, fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.85)' }}>
          {user ? user.email : 'Explora tus pedidos, métodos de pago y beneficios'}
        </p>

        {user && (
          <div style={{ marginTop: '6px' }}>
            <span style={{
              background: 'rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              padding: '3px 12px',
              borderRadius: '999px',
              fontSize: '0.74rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Rol: {role || 'Cliente'} (Protegido)
            </span>
          </div>
        )}

        {!user && (
          <button
            type="button"
            onClick={() => setShowAuthForm(true)}
            style={{
              marginTop: '14px',
              backgroundColor: 'var(--golden-orange)',
              color: '#000000',
              border: 'none',
              padding: '8px 20px',
              borderRadius: '999px',
              fontWeight: 800,
              fontSize: '0.82rem',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(239, 157, 36, 0.35)'
            }}
          >
            Iniciar Sesión / Registrarse
          </button>
        )}
      </header>

      {/* BANNER DE NOTIFICACIÓN DE ÉXITO */}
      {successBanner && (
        <div style={{ margin: '14px 20px 0 20px', background: '#ecfdf5', border: '1.5px solid #10b981', color: '#065f46', padding: '12px 16px', borderRadius: '14px', fontSize: '0.86rem', fontWeight: 700 }}>
          {successBanner}
        </div>
      )}

      {/* FORMULARIO DE INICIO DE SESIÓN CON BOTÓN DE VISIBILIDAD DE MONO (🙈 / 🐵) */}
      {!user && showAuthForm && (
        <div style={{ padding: '20px' }}>
          <div style={{
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '20px',
            padding: '20px',
            boxShadow: '0 4px 14px rgba(0,0,0,0.05)'
          }}>
            <h3 style={{ margin: '0 0 6px 0', color: 'var(--dark-amaranth)' }}>Iniciar Sesión</h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '0.82rem', color: '#6b7280' }}>
              Accede a tu cuenta de cliente o perfil del personal.
            </p>

            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: '10px' }}>
                <input
                  type="email"
                  className="form-input-figma"
                  placeholder="Correo electrónico"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>

              {/* Input interactivo con emoticón de mono 🙈 / 🐵 */}
              <PasswordInput
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Contraseña"
                required
              />

              {/* Verificación de Seguridad Anti-Bot Zero-Trust */}
              <SecurityVerification
                action="login"
                onVerify={(_, isValid) => setBotVerified(isValid)}
              />

              <button
                type="submit"
                className="btn-primario"
                style={{ width: '100%', padding: '12px', marginTop: '4px' }}
                disabled={loading}
              >
                {loading ? 'Ingresando...' : 'Iniciar Sesión'}
              </button>
            </form>

            {errorMsg && (
              <div style={{ background: '#fee2e2', border: '1px solid #ef4444', color: '#b91c1c', padding: '8px 12px', borderRadius: '10px', fontSize: '0.8rem', marginTop: '10px' }}>
                {errorMsg}
              </div>
            )}

            <div style={{ borderTop: '1px solid #e5e7eb', marginTop: '14px', paddingTop: '12px', textAlign: 'center' }}>
              <Link to="/registro" style={{ color: 'var(--dark-amaranth)', fontSize: '0.84rem', fontWeight: 700, textDecoration: 'none' }}>
                ¿No tienes cuenta? Regístrate aquí →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* LISTA DE PASTILLAS DEL MENÚ FIGMA ('user') */}
      <nav className="user-menu-list">
        
        {/* 1. Mis Pedidos (Historial Completo) */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => {
            setModalType('pedidos');
            cargarHistorial();
          }}
        >
          <span style={{ fontSize: '1.25rem' }}>📦</span>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <span style={{ display: 'block' }}>Mis Pedidos & Historial</span>
            <small style={{ color: '#6b7280', fontSize: '0.74rem' }}>Consulta compras anteriores o repite pedidos</small>
          </div>
          {ultimaOrdenId && (
            <span style={{ background: '#10b981', color: '#fff', fontSize: '0.72rem', padding: '3px 8px', borderRadius: '999px', fontWeight: 800 }}>
              En Curso
            </span>
          )}
          <span style={{ color: '#9ca3af' }}>›</span>
        </button>

        {/* 2. Platos Favoritos */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => {
            setModalType('favoritos');
            cargarPlatosFavoritos();
          }}
        >
          <span style={{ fontSize: '1.25rem' }}>❤️</span>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <span style={{ display: 'block' }}>Platos Favoritos</span>
            <small style={{ color: '#6b7280', fontSize: '0.74rem' }}>Tus comidas preferidas guardadas</small>
          </div>
          <span style={{ color: '#9ca3af' }}>›</span>
        </button>

        {/* 3. Mis Direcciones (Múltiples y Envíos a Terceros) */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => {
            setDirecciones(addressService.getAddresses());
            setModalType('direcciones');
          }}
        >
          <span style={{ fontSize: '1.25rem' }}>📍</span>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div>Mis direcciones & Envíos a terceros</div>
            <small style={{ color: '#6b7280', fontSize: '0.75rem', display: 'block' }}>
              {direcciones.find(d => d.isDefault)?.alias || 'Gestionar ubicaciones con mapa'}
            </small>
          </div>
          <span style={{ color: '#9ca3af' }}>›</span>
        </button>

        {/* 4. Mis Datos Personales */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => {
            setProfileFeedback('');
            setModalType('datos');
          }}
        >
          <span style={{ fontSize: '1.25rem' }}>👤</span>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div>Mis datos personales</div>
            <small style={{ color: '#6b7280', fontSize: '0.74rem' }}>Edita tu nombre, correo o teléfono con seguridad</small>
          </div>
          <span style={{ color: '#9ca3af' }}>›</span>
        </button>

        {/* 5. Seguridad & Contraseña */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => {
            setPwdFeedback('');
            setModalType('clave');
          }}
        >
          <span style={{ fontSize: '1.25rem' }}>🔐</span>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div>Seguridad & Contraseña</div>
            <small style={{ color: '#6b7280', fontSize: '0.74rem' }}>Cambio seguro con verificación obligatoria</small>
          </div>
          <span style={{ color: '#9ca3af' }}>›</span>
        </button>

        {/* 6. Métodos de Pago */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => setModalType('pagos')}
        >
          <span style={{ fontSize: '1.25rem' }}>💳</span>
          <span style={{ flex: 1, textAlign: 'left' }}>Métodos de pago</span>
          <span style={{ color: '#9ca3af' }}>›</span>
        </button>

        {/* 7. Soporte */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => setModalType('soporte')}
        >
          <span style={{ fontSize: '1.25rem' }}>🎧</span>
          <span style={{ flex: 1, textAlign: 'left' }}>Soporte Oficial (0414-1352503)</span>
          <span style={{ color: '#9ca3af' }}>›</span>
        </button>

        {/* ACCESOS DE ROL PARA PERSONAL */}
        {role === 'restaurant' && (
          <Link to="/cocina" className="user-menu-item" style={{ background: '#fef3c7', borderColor: '#f59e0b' }}>
            <span style={{ fontSize: '1.25rem' }}>👨‍🍳</span>
            <span style={{ flex: 1, fontWeight: 700, color: '#92400e' }}>Panel de Cocina</span>
            <span style={{ color: '#92400e' }}>›</span>
          </Link>
        )}

        {role === 'delivery' && (
          <Link to="/delivery" className="user-menu-item" style={{ background: '#d1fae5', borderColor: '#10b981' }}>
            <span style={{ fontSize: '1.25rem' }}>🛵</span>
            <span style={{ flex: 1, fontWeight: 700, color: '#065f46' }}>Panel de Repartidor</span>
            <span style={{ color: '#065f46' }}>›</span>
          </Link>
        )}

        {role === 'admin' && (
          <Link to="/admin" className="user-menu-item" style={{ background: '#ede9fe', borderColor: '#8b5cf6' }}>
            <span style={{ fontSize: '1.25rem' }}>🛡️</span>
            <span style={{ flex: 1, fontWeight: 700, color: '#5b21b6' }}>Panel Administrador</span>
            <span style={{ color: '#5b21b6' }}>›</span>
          </Link>
        )}

        {/* Cerrar Sesión */}
        {user && (
          <button
            type="button"
            className="user-menu-item"
            onClick={() => {
              if (window.confirm('¿Seguro que deseas cerrar sesión?')) {
                signOut();
              }
            }}
            style={{ color: '#b91c1c' }}
          >
            <span style={{ fontSize: '1.25rem' }}>🚪</span>
            <span style={{ flex: 1, textAlign: 'left', fontWeight: 700 }}>Cerrar Sesión</span>
            <span style={{ color: '#b91c1c' }}>›</span>
          </button>
        )}

      </nav>

      {/* =========================================================================
          MODAL 1: HISTORIAL DE PEDIDOS
          ========================================================================= */}
      {modalType === 'pedidos' && (
        <div className="modal-figma-overlay" onClick={() => setModalType(null)}>
          <div className="modal-figma-sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)' }}>📦 Historial de Compras</h3>
              <button onClick={() => setModalType(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer' }}>✕</button>
            </div>

            {loadingHistorial ? (
              <p style={{ color: '#6b7280', textAlign: 'center', padding: '20px' }}>Cargando compras anteriores...</p>
            ) : historialOrdenes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px' }}>
                <span style={{ fontSize: '2.5rem' }}>🛒</span>
                <p style={{ color: '#6b7280', marginTop: '10px' }}>Aún no has registrado pedidos anteriores.</p>
                <Link to="/" onClick={() => setModalType(null)} className="btn-primario" style={{ display: 'inline-block', marginTop: '8px' }}>
                  Explorar Catálogo
                </Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {historialOrdenes.map(ord => {
                  const items = Array.isArray(ord.items) ? ord.items : [];
                  const f = new Date(ord.created_at);
                  const fechaStr = `${f.toLocaleDateString()} ${f.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                  return (
                    <div key={ord.id} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '14px', padding: '14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <strong style={{ fontSize: '0.92rem', color: 'var(--dark-amaranth)' }}>
                          #ORD-{(ord.id || '').slice(0, 8).toUpperCase()}
                        </strong>
                        <span className="badge" style={{ fontSize: '0.72rem', background: ord.status === 'delivered' ? '#ecfdf5' : '#fef3c7', color: ord.status === 'delivered' ? '#065f46' : '#92400e' }}>
                          {ord.status === 'delivered' ? '🎉 Entregado' : ord.status === 'cancelled' ? '❌ Cancelado' : '⏳ En Proceso'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '8px' }}>
                        {fechaStr} • <strong>{ord.businesses?.name || 'Tropicalia'}</strong>
                      </div>
                      <div style={{ fontSize: '0.82rem', borderTop: '1px dashed #e5e7eb', paddingTop: '6px', marginBottom: '8px' }}>
                        {items.map((it, idx) => (
                          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>{it.quantity}x {it.name}</span>
                            <span>{formatUsd(it.price * it.quantity)}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 800, fontSize: '0.9rem', marginBottom: '10px' }}>
                        <span>Total:</span>
                        <span style={{ color: 'var(--dark-amaranth)' }}>{formatUsd(ord.total)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setModalType(null);
                            navigate(`/tracking?order_id=${ord.id}`);
                          }}
                          className="btn-secundario"
                          style={{ flex: 1, padding: '6px', fontSize: '0.76rem' }}
                        >
                          🔍 Ver Seguimiento
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRepetirPedido(ord)}
                          className="btn-primario"
                          style={{ flex: 1, padding: '6px', fontSize: '0.76rem' }}
                        >
                          🔄 Repetir Pedido
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 2: PLATOS FAVORITOS
          ========================================================================= */}
      {modalType === 'favoritos' && (
        <div className="modal-figma-overlay" onClick={() => setModalType(null)}>
          <div className="modal-figma-sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)' }}>❤️ Mis Platos Favoritos</h3>
              <button onClick={() => setModalType(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer' }}>✕</button>
            </div>

            {loadingFavoritos ? (
              <p style={{ color: '#6b7280', textAlign: 'center', padding: '20px' }}>Cargando favoritos...</p>
            ) : platosFavoritos.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px' }}>
                <span style={{ fontSize: '2.5rem' }}>🤍</span>
                <p style={{ color: '#6b7280', marginTop: '10px' }}>No tienes platos favoritos guardados aún.</p>
                <small style={{ color: '#9ca3af' }}>Toca el corazón ❤️ en cualquier plato del catálogo para guardarlo aquí.</small>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }}>
                {platosFavoritos.map(p => (
                  <div key={p.id} className="product-card-figma" style={{ margin: 0, padding: '10px' }}>
                    <div className="product-card-img-box" style={{ height: '90px' }}>
                      <img src={getProductImageUrl(p)} alt={p.name} className="product-card-img" />
                    </div>
                    <h4 className="product-card-name" style={{ fontSize: '0.82rem' }}>{p.name}</h4>
                    <small style={{ color: '#6b7280', fontSize: '0.72rem', display: 'block' }}>{p.businesses?.name}</small>
                    <p className="product-card-price" style={{ fontSize: '0.88rem' }}>{formatUsd(p.price)}</p>
                    <button
                      type="button"
                      onClick={() => {
                        addItem(
                          { id: p.id, name: p.name, price: parseFloat(p.price), image_url: p.image_url, quantity: 1 },
                          p.business_id,
                          p.businesses?.name
                        );
                        alert(`¡${p.name} agregado al carrito!`);
                      }}
                      className="btn-primario"
                      style={{ width: '100%', padding: '6px', fontSize: '0.75rem', marginTop: '6px' }}
                    >
                      + Agregar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 3: DIRECCIONES MÚLTIPLES & ENVÍOS A TERCEROS
          ========================================================================= */}
      {modalType === 'direcciones' && (
        <div className="modal-figma-overlay" onClick={() => setModalType(null)}>
          <div className="modal-figma-sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)' }}>📍 Mis Direcciones de Entrega</h3>
              <button onClick={() => setModalType(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer' }}>✕</button>
            </div>

            {/* Lista de direcciones guardadas */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
              {direcciones.map(addr => (
                <div
                  key={addr.id}
                  style={{
                    background: addr.isDefault ? '#fffbeb' : '#ffffff',
                    border: addr.isDefault ? '1.5px solid var(--golden-orange)' : '1px solid #e5e7eb',
                    borderRadius: '12px',
                    padding: '12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '2px' }}>
                      <strong style={{ fontSize: '0.88rem', color: 'var(--dark-amaranth)' }}>
                        {addr.esTercero ? `🎁 ${addr.alias}` : `🏠 ${addr.alias}`}
                      </strong>
                      {addr.isDefault && (
                        <span style={{ background: '#10b981', color: '#fff', fontSize: '0.68rem', padding: '1px 6px', borderRadius: '999px', fontWeight: 800 }}>
                          Predeterminada
                        </span>
                      )}
                    </div>
                    {addr.esTercero && addr.recipientName && (
                      <span style={{ fontSize: '0.76rem', color: '#92400e', display: 'block', fontWeight: 600 }}>
                        Destinatario: {addr.recipientName} ({addr.recipientPhone})
                      </span>
                    )}
                    <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#4b5563' }}>
                      {addr.address}
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {!addr.isDefault && (
                      <button
                        type="button"
                        onClick={() => addressService.setDefault(addr.id, user?.id).then(setDirecciones)}
                        className="btn-secundario"
                        style={{ padding: '4px 8px', fontSize: '0.72rem' }}
                      >
                        Activar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('¿Eliminar esta dirección?')) {
                          addressService.deleteAddress(addr.id, user?.id).then(setDirecciones);
                        }
                      }}
                      style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '0.75rem', cursor: 'pointer', padding: '4px' }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Botón o Formulario para agregar nueva dirección */}
            {!showAddAddressForm ? (
              <button
                type="button"
                onClick={() => setShowAddAddressForm(true)}
                className="btn-primario"
                style={{ width: '100%', padding: '10px' }}
              >
                + Agregar Nueva Dirección / Envío a Tercero
              </button>
            ) : (
              <form onSubmit={handleCrearDireccion} style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '14px', padding: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <strong style={{ fontSize: '0.9rem', color: 'var(--dark-amaranth)' }}>Registrar Ubicación</strong>
                  <button type="button" onClick={() => setShowAddAddressForm(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>✕</button>
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 700 }}>Nombre o Alias:</label>
                  <input
                    type="text"
                    value={newAddrAlias}
                    onChange={e => setNewAddrAlias(e.target.value)}
                    placeholder="Ej: Casa, Oficina, Casa de Mamá..."
                    className="form-input-figma"
                    required
                  />
                </div>

                {/* Envío a Tercero Checkbox */}
                <div style={{ marginBottom: '10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '8px 10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontWeight: 700, color: '#92400e', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={newAddrEsTercero}
                      onChange={e => setNewAddrEsTercero(e.target.checked)}
                    />
                    🎁 ¿Es un envío para otra persona (Tercero)?
                  </label>

                  {newAddrEsTercero && (
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <input
                        type="text"
                        placeholder="Nombre de la persona que recibe"
                        value={newAddrRecipientName}
                        onChange={e => setNewAddrRecipientName(e.target.value)}
                        className="form-input-figma"
                        required={newAddrEsTercero}
                      />
                      <input
                        type="tel"
                        placeholder="Teléfono del destinatario"
                        value={newAddrRecipientPhone}
                        onChange={e => setNewAddrRecipientPhone(e.target.value)}
                        className="form-input-figma"
                        required={newAddrEsTercero}
                      />
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 700 }}>Dirección exacta y referencia:</label>
                  <input
                    type="text"
                    value={newAddrText}
                    onChange={e => setNewAddrText(e.target.value)}
                    placeholder="Calle, Edificio, Apto, Punto de referencia..."
                    className="form-input-figma"
                    required
                  />
                </div>

                {/* MAPA INTERACTIVO LEAFLET PARA FIJAR PIN */}
                <MapAddressPicker
                  initialLat={newAddrCoords.lat}
                  initialLng={newAddrCoords.lng}
                  onLocationChange={setNewAddrCoords}
                  height="180px"
                />

                <div style={{ marginBottom: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#4b5563', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={newAddrIsDefault}
                      onChange={e => setNewAddrIsDefault(e.target.checked)}
                    />
                    Establecer como dirección predeterminada
                  </label>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" onClick={() => setShowAddAddressForm(false)} className="btn-secundario" style={{ flex: 1, padding: '8px' }}>
                    Cancelar
                  </button>
                  <button type="submit" disabled={savingAddress} className="btn-primario" style={{ flex: 1, padding: '8px' }}>
                    {savingAddress ? 'Guardando...' : 'Guardar Dirección'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 4: MIS DATOS PERSONALES (NOMBRE, CORREO, TELÉFONO)
          ========================================================================= */}
      {modalType === 'datos' && (
        <div className="modal-figma-overlay" onClick={() => setModalType(null)}>
          <div className="modal-figma-sheet" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)' }}>👤 Mis Datos Personales</h3>
              <button onClick={() => setModalType(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer' }}>✕</button>
            </div>

            {user ? (
              <form onSubmit={handleGuardarDatosPersonales} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                    Nombre de Usuario / Nombre Completo:
                  </label>
                  <input
                    type="text"
                    value={editNombre}
                    onChange={e => setEditNombre(e.target.value)}
                    className="form-input-figma"
                    required
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                    Correo Electrónico:
                  </label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={e => setEditEmail(e.target.value)}
                    className="form-input-figma"
                    required
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                    Teléfono (WhatsApp):
                  </label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                    className="form-input-figma"
                    required
                  />
                </div>

                {/* Confirmación obligatoria de contraseña si se modifica correo o teléfono */}
                {(editEmail.trim().toLowerCase() !== user.email?.toLowerCase() || editPhone.trim() !== user.user_metadata?.phone) && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '10px' }}>
                    <small style={{ color: '#92400e', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                      🔒 Por seguridad, ingresa tu contraseña actual para confirmar el cambio de correo o teléfono:
                    </small>
                    <PasswordInput
                      value={currentPwdForProfile}
                      onChange={e => setCurrentPwdForProfile(e.target.value)}
                      placeholder="Contraseña actual"
                      required
                    />
                  </div>
                )}

                <div style={{ background: '#f3f4f6', padding: '10px', borderRadius: '10px', fontSize: '0.78rem', color: '#4b5563' }}>
                  <strong>Rol de la cuenta:</strong> <span style={{ textTransform: 'uppercase', color: 'var(--dark-amaranth)', fontWeight: 800 }}>{role || 'Cliente'}</span>
                  <small style={{ display: 'block', color: '#6b7280', marginTop: '2px' }}>
                    🔒 Tu rol está protegido e inmutable por las políticas de seguridad del backend.
                  </small>
                </div>

                {profileFeedback && (
                  <div style={{ fontSize: '0.82rem', padding: '8px 10px', borderRadius: '8px', background: profileFeedback.startsWith('✅') ? '#ecfdf5' : '#fee2e2', color: profileFeedback.startsWith('✅') ? '#065f46' : '#b91c1c' }}>
                    {profileFeedback}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={profileSubmitting}
                  className="btn-primario"
                  style={{ width: '100%', padding: '10px', marginTop: '6px' }}
                >
                  {profileSubmitting ? 'Guardando cambios...' : 'Guardar Datos Personales'}
                </button>
              </form>
            ) : (
              <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>
                Inicia sesión para gestionar tus datos personales.
              </p>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 5: CAMBIO SEGURO DE CONTRASEÑA (CON VISIBILIDAD DE MONO 🙈/🐵)
          ========================================================================= */}
      {modalType === 'clave' && (
        <div className="modal-figma-overlay" onClick={() => setModalType(null)}>
          <div className="modal-figma-sheet" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)' }}>🔐 Cambio Seguro de Contraseña</h3>
              <button onClick={() => setModalType(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer' }}>✕</button>
            </div>

            <p style={{ fontSize: '0.82rem', color: '#4b5563', margin: '0 0 14px 0' }}>
              Por seguridad, introduce tu contraseña actual y la nueva clave. Se enviará un correo de verificación obligatorio a tu dirección registrada para aplicar el cambio automáticamente en Supabase sin intervención de administradores.
            </p>

            <form onSubmit={handleSolicitarCambioClave} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                  1. Contraseña actual:
                </label>
                <PasswordInput
                  value={currentPwd}
                  onChange={e => setCurrentPwd(e.target.value)}
                  placeholder="Tu contraseña actual"
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                  2. Nueva contraseña (mínimo 6 caracteres):
                </label>
                <PasswordInput
                  value={newPwd}
                  onChange={e => setNewPwd(e.target.value)}
                  placeholder="Nueva contraseña segura"
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                  3. Confirmar nueva contraseña:
                </label>
                <PasswordInput
                  value={confirmPwd}
                  onChange={e => setConfirmPwd(e.target.value)}
                  placeholder="Repite la nueva contraseña"
                  required
                />
              </div>

              {pwdFeedback && (
                <div style={{ fontSize: '0.82rem', padding: '10px', borderRadius: '8px', background: pwdFeedback.startsWith('✅') ? '#ecfdf5' : '#fee2e2', color: pwdFeedback.startsWith('✅') ? '#065f46' : '#b91c1c' }}>
                  {pwdFeedback}
                </div>
              )}

              <button
                type="submit"
                disabled={pwdSubmitting}
                className="btn-primario"
                style={{ width: '100%', padding: '12px', marginTop: '6px' }}
              >
                {pwdSubmitting ? 'Verificando y enviando...' : '🔒 Enviar Verificación por Correo'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 6: MÉTODOS DE PAGO
          ========================================================================= */}
      {modalType === 'pagos' && (
        <div className="modal-figma-overlay" onClick={() => setModalType(null)}>
          <div className="modal-figma-sheet" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)' }}>💳 Métodos de Pago Aceptados</h3>
              <button onClick={() => setModalType(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
              <div style={{ padding: '10px', background: '#f3f4f6', borderRadius: '10px' }}>
                <strong>📱 Pago Móvil (Bs.)</strong> • Tasa oficial BCV. Banesco, Venezuela, Mercantil.
              </div>
              <div style={{ padding: '10px', background: '#f3f4f6', borderRadius: '10px' }}>
                <strong>🟡 Binance Pay (USDT)</strong> • Pagos instantáneos sin comisiones.
              </div>
              <div style={{ padding: '10px', background: '#f3f4f6', borderRadius: '10px' }}>
                <strong>🟣 Zelle & Zinli (USD)</strong> • Dólares digitales acreditados al instante.
              </div>
              <div style={{ padding: '10px', background: '#f3f4f6', borderRadius: '10px' }}>
                <strong>💵 Efectivo & Punto de Venta</strong> • Contra entrega en mostrador o delivery.
              </div>
            </div>
            <button onClick={() => setModalType(null)} className="btn-primario" style={{ width: '100%', marginTop: '14px' }}>
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 7: SOPORTE OFICIAL (0414-1352503)
          ========================================================================= */}
      {modalType === 'soporte' && (
        <div className="modal-figma-overlay" onClick={() => setModalType(null)}>
          <div className="modal-figma-sheet" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)' }}>🎧 Atención y Soporte</h3>
              <button onClick={() => setModalType(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer' }}>✕</button>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#4b5563', margin: '0 0 16px 0' }}>
              Línea directa oficial de atención comercial y soporte al cliente de Tropicalia CRB: <strong>0414-1352503</strong> (+58 414 135 2503).
            </p>
            <a
              href="https://wa.me/584141352503?text=Hola%20Tropicalia,%20necesito%20asistencia%20con%20mi%20cuenta"
              target="_blank"
              rel="noreferrer"
              className="btn-primario"
              style={{ width: '100%', display: 'block', textAlign: 'center', background: '#25D366' }}
            >
              💬 Chatear por WhatsApp (0414-1352503)
            </a>
            <button onClick={() => setModalType(null)} className="btn-secundario" style={{ width: '100%', marginTop: '10px' }}>
              Cerrar
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
