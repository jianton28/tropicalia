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
import tropiHeadImg from '../assets/tropi_head.png';
import {
  WhatsAppIcon,
  HeartOutlineIcon,
  TrashVinoIcon,
  ChefHat,
  Bike,
  Shield,
  ShoppingBag,
  User,
  KeyRound,
  Mail,
  Sparkles,
  Headphones,
  CreditCard,
  X,
  MapPin,
  Lock
} from '../components/common/Icons';

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
    applyPendingPasswordUpdate,
    sendPasswordResetEmail,
    resendVerificationEmail
  } = useAuth();
  const { addItem } = useCart();

  // Estados de inicio de sesión si no está autenticado
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successBanner, setSuccessBanner] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAuthForm, setShowAuthForm] = useState(!user);
  const [showSplashScreen, setShowSplashScreen] = useState(() => searchParams.get('welcome') === '1');
  const [botVerified, setBotVerified] = useState(false);

  // Estados para recuperación de contraseña y reenvío de confirmación
  const [authRecoveryMode, setAuthRecoveryMode] = useState(null); // null | 'forgot_password' | 'resend_confirm'
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryMsg, setRecoveryMsg] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  // Modal de restablecimiento de contraseña (cuando llega del enlace de correo)
  const [showResetModal, setShowResetModal] = useState(false);
  const [recoveryNewPwd, setRecoveryNewPwd] = useState('');
  const [recoveryConfirmPwd, setRecoveryConfirmPwd] = useState('');
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);
  const [recoveryFeedback, setRecoveryFeedback] = useState('');

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

  // Detectar confirmación automática de contraseña por correo o evento de recuperación
  useEffect(() => {
    if (searchParams.get('verify_pwd_update') === '1') {
      applyPendingPasswordUpdate()
        .then((ok) => {
          if (ok) {
            setSuccessBanner('Tu contraseña ha sido confirmada y actualizada exitosamente en Supabase.');
          }
        })
        .catch((err) => {
          setErrorMsg('Error al aplicar nueva contraseña: ' + err.message);
        });
    }

    // Detectar enlace de restablecimiento de contraseña
    if (searchParams.get('reset_pwd') === '1' || (typeof window !== 'undefined' && window.location.hash?.includes('type=recovery'))) {
      setShowResetModal(true);
    }

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setShowResetModal(true);
      }
    });

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

    return () => {
      authListener?.subscription?.unsubscribe();
    };
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

      let prods = null;
      // Intento 1: Join con clave foránea explícita
      try {
        const { data: d1, error: e1 } = await supabase
          .from('products')
          .select('*, businesses!business_id(id, name, lat, lng)')
          .in('id', favIds)
          .eq('is_available', true);

        if (!e1 && d1) prods = d1;
      } catch (ex) {}

      // Intento 2: Join estándar
      if (!prods) {
        try {
          const { data: d2, error: e2 } = await supabase
            .from('products')
            .select('*, businesses(id, name, lat, lng)')
            .in('id', favIds)
            .eq('is_available', true);

          if (!e2 && d2) prods = d2;
        } catch (ex) {}
      }

      // Intento 3: Fallback resiliente (evita Error 400)
      if (!prods) {
        try {
          const { data: rawProds } = await supabase
            .from('products')
            .select('*')
            .in('id', favIds)
            .eq('is_available', true);

          if (rawProds && rawProds.length > 0) {
            const bizIds = [...new Set(rawProds.map(p => p.business_id).filter(Boolean))];
            const { data: bData } = await supabase
              .from('businesses')
              .select('id, name, lat, lng')
              .in('id', bizIds);

            const bMap = new Map((bData || []).map(b => [b.id, b]));
            prods = rawProds.map(p => ({
              ...p,
              businesses: bMap.get(p.business_id) || null
            }));
          }
        } catch (ex) {
          console.warn('Fallback favoritos:', ex);
        }
      }

      if (prods) {
        setPlatosFavoritos(prods);
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
      setErrorMsg(`Has superado el límite de intentos permitidos. Por seguridad, tu acceso está temporalmente pausado. Intenta de nuevo en ${rlCheck.remainingSeconds} segundos.`);
      return;
    }

    // 2. Verificación Anti-Bot / Turnstile
    if (!botVerified) {
      setErrorMsg('Por favor completa la verificación de seguridad anti-bot antes de ingresar.');
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
        setErrorMsg('5 intentos fallidos alcanzados. Acceso bloqueado por 15 minutos para prevenir ataques de fuerza bruta.');
      } else {
        setErrorMsg(`Credenciales inválidas: ${err.message}. Intentos restantes: ${postCheck.attemptsLeft}`);
      }
      setLoading(false);
    }
  }

  // Envío oficial de correo de recuperación de contraseña apuntando a producción
  async function handleSendPasswordReset(e) {
    if (e && e.preventDefault) e.preventDefault();
    const targetEmail = (recoveryEmail.trim() || email.trim()).toLowerCase();
    if (!targetEmail) {
      setRecoveryMsg('Por favor ingresa tu correo electrónico.');
      return;
    }
    if (!securityService.validateEmail(targetEmail)) {
      setRecoveryMsg('Por favor ingresa un correo electrónico válido.');
      return;
    }

    setRecoveryLoading(true);
    setRecoveryMsg('');
    try {
      await sendPasswordResetEmail(targetEmail);
      setRecoveryMsg(`Enlace enviado con éxito. Revisa tu bandeja de entrada en ${targetEmail}. Al hacer clic en el enlace oficial de Tropicalia podrás ingresar tu nueva contraseña.`);
    } catch (err) {
      setRecoveryMsg(`Error enviando enlace: ${err.message || 'Intenta de nuevo más tarde.'}`);
    } finally {
      setRecoveryLoading(false);
    }
  }

  // Reenvío de confirmación de registro
  async function handleResendConfirmation(e) {
    if (e && e.preventDefault) e.preventDefault();
    const targetEmail = (recoveryEmail.trim() || email.trim()).toLowerCase();
    if (!targetEmail) {
      setRecoveryMsg('Por favor ingresa tu correo electrónico.');
      return;
    }
    if (!securityService.validateEmail(targetEmail)) {
      setRecoveryMsg('Por favor ingresa un correo electrónico válido.');
      return;
    }

    setRecoveryLoading(true);
    setRecoveryMsg('');
    try {
      await resendVerificationEmail(targetEmail);
      setRecoveryMsg(`Correo reenviado con éxito. Revisa tu bandeja de entrada o spam en ${targetEmail}.`);
    } catch (err) {
      setRecoveryMsg(`Error reenviando correo: ${err.message || 'Intenta de nuevo más tarde.'}`);
    } finally {
      setRecoveryLoading(false);
    }
  }

  // Aplicación de nueva clave desde el enlace de restablecimiento
  async function handleApplyRecoveryPassword(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!recoveryNewPwd || recoveryNewPwd.length < 6) {
      setRecoveryFeedback('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (recoveryNewPwd !== recoveryConfirmPwd) {
      setRecoveryFeedback('Las contraseñas no coinciden.');
      return;
    }

    setRecoverySubmitting(true);
    setRecoveryFeedback('');
    try {
      const { error } = await supabase.auth.updateUser({ password: recoveryNewPwd });
      if (error) throw error;
      setSuccessBanner('Tu contraseña ha sido restablecida exitosamente. Ya puedes usar tu nueva clave.');
      setShowResetModal(false);
      setRecoveryNewPwd('');
      setRecoveryConfirmPwd('');
      navigate('/portal', { replace: true });
    } catch (err) {
      setRecoveryFeedback(`Error al actualizar contraseña: ${err.message}`);
    } finally {
      setRecoverySubmitting(false);
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
      alert('Dirección registrada exitosamente.');
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

      setProfileFeedback('Datos actualizados exitosamente. Si modificaste tu correo, revisa tu bandeja de entrada para confirmarlo.');
      setCurrentPwdForProfile('');
    } catch (err) {
      setProfileFeedback('Error: ' + err.message);
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

      setPwdFeedback(res.message);
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
    } catch (err) {
      setPwdFeedback('Error: ' + err.message);
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

  // PANTALLA 1: BIENVENIDA / SPLASH OFICIAL (Screenshot 225140)
  if (!user && showSplashScreen) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--tropicalia-radial)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        textAlign: 'center'
      }}>
        <div style={{
          width: '148px',
          height: '148px',
          borderRadius: '50%',
          background: '#dcdcdc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '26px',
          boxShadow: '0 10px 28px rgba(0, 0, 0, 0.35)',
          padding: '14px'
        }}>
          <img
            src={tropiHeadImg}
            alt="Tropicalia CRB"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </div>

        <button
          type="button"
          onClick={() => {
            setShowSplashScreen(false);
            setShowAuthForm(true);
          }}
          style={{
            background: '#ffffff',
            color: 'var(--dark-amaranth)',
            border: 'none',
            borderRadius: '10px',
            padding: '12px 34px',
            fontFamily: 'var(--font-display)',
            fontSize: '1.1rem',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.25)',
            transition: 'transform 0.15s ease'
          }}
        >
          Iniciar Sesión
        </button>

        <button
          type="button"
          onClick={() => {
            setShowSplashScreen(false);
            setShowAuthForm(false);
            navigate('/');
          }}
          style={{
            marginTop: '20px',
            background: 'none',
            border: 'none',
            color: 'rgba(255, 255, 255, 0.85)',
            fontSize: '0.84rem',
            fontWeight: 600,
            textDecoration: 'underline',
            cursor: 'pointer'
          }}
        >
          Explorar menú como invitado →
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', minHeight: '100vh', backgroundColor: '#ffffff', paddingBottom: '90px' }}>
      
      {/* HEADER PLANO OFICIAL FIGMA ('Inicio de Sesión' cuando !user && showAuthForm; o 'User' cuando perfil/invitado) */}
      {!user && showAuthForm ? (
        <header className="figma-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 className="figma-header-title" style={{ fontSize: '1.45rem' }}>
            Inicio de Sesión
          </h1>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setShowSplashScreen(true)}
              style={{
                background: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.28)',
                color: '#ffffff',
                borderRadius: '999px',
                padding: '4px 10px',
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
              title="Ver Pantalla de Bienvenida"
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Sparkles size={12} /> Inicio
              </span>
            </button>
            <button
              type="button"
              onClick={() => setShowAuthForm(false)}
              style={{
                background: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.28)',
                color: '#ffffff',
                borderRadius: '999px',
                padding: '4px 10px',
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Invitado ›
            </button>
          </div>
        </header>
      ) : (
        <header className="figma-header" style={{ textAlign: 'center', padding: '28px 20px 22px 20px' }}>
          <div style={{
            width: '78px',
            height: '78px',
            backgroundColor: '#dcdcdc',
            color: 'var(--dark-amaranth)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-display)',
            fontSize: '2rem',
            fontWeight: 700,
            margin: '0 auto 10px auto',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)'
          }}>
            {user ? inicial : <User size={34} color="var(--dark-amaranth)" />}
          </div>

          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', margin: '0 0 3px 0', color: '#ffffff' }}>
            {nombreMostrar}
          </h1>

          <p style={{ margin: 0, fontSize: '0.84rem', color: 'rgba(255, 255, 255, 0.88)' }}>
            {user ? user.email : 'Explora tus pedidos, métodos de pago y beneficios'}
          </p>

          {user && (
            <div style={{ marginTop: '6px' }}>
              <span style={{
                background: 'rgba(255, 255, 255, 0.18)',
                color: '#ffffff',
                padding: '3px 12px',
                borderRadius: '999px',
                fontSize: '0.72rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Rol: {role || 'Cliente'}
              </span>
            </div>
          )}

          {!user && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '12px' }}>
              <button
                type="button"
                onClick={() => setShowAuthForm(true)}
                style={{
                  backgroundColor: 'var(--golden-orange)',
                  color: '#000000',
                  border: 'none',
                  padding: '8px 20px',
                  borderRadius: '999px',
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(239, 157, 36, 0.35)'
                }}
              >
                Iniciar Sesión / Registrarse
              </button>
            </div>
          )}
        </header>
      )}

      {/* BANNER DE NOTIFICACIÓN DE ÉXITO */}
      {successBanner && (
        <div style={{ margin: '14px 20px 0 20px', background: '#ecfdf5', border: '1.5px solid #10b981', color: '#065f46', padding: '12px 16px', borderRadius: '14px', fontSize: '0.86rem', fontWeight: 700 }}>
          {successBanner}
        </div>
      )}

      {/* FORMULARIO DE INICIO DE SESIÓN CON BOTÓN DE VISIBILIDAD DE OJO PLANO EN COLOR VINO */}
      {!user && showAuthForm && (
        <div style={{ padding: '20px' }}>
          {authRecoveryMode === 'forgot_password' ? (
            <div style={{
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: '20px',
              padding: '20px',
              boxShadow: '0 4px 14px rgba(0,0,0,0.05)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <KeyRound size={18} color="var(--dark-amaranth)" /> Recuperar Contraseña
                </h3>
                <button
                  type="button"
                  onClick={() => { setAuthRecoveryMode(null); setRecoveryMsg(''); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', display: 'flex', alignItems: 'center' }}
                  aria-label="Cerrar"
                >
                  <X size={16} />
                </button>
              </div>
              <p style={{ margin: '0 0 16px 0', fontSize: '0.82rem', color: '#4b5563', lineHeight: 1.4 }}>
                Ingresa tu correo y te enviaremos un enlace oficial seguro para que restablezcas tu contraseña sin enlaces fallidos a localhost:3000.
              </p>

              <form onSubmit={handleSendPasswordReset}>
                <div style={{ marginBottom: '12px' }}>
                  <input
                    type="email"
                    className="form-input-figma"
                    placeholder="Tu correo electrónico registrado"
                    value={recoveryEmail}
                    onChange={e => setRecoveryEmail(e.target.value)}
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="btn-primario"
                  style={{ width: '100%', padding: '12px' }}
                  disabled={recoveryLoading}
                >
                  {recoveryLoading ? 'Enviando enlace...' : 'Enviar Enlace de Recuperación'}
                </button>
              </form>

              {recoveryMsg && (
                <div style={{
                  background: (!recoveryMsg.toLowerCase().includes('error') && !recoveryMsg.toLowerCase().includes('por favor')) ? '#ecfdf5' : '#fee2e2',
                  border: `1px solid ${(!recoveryMsg.toLowerCase().includes('error') && !recoveryMsg.toLowerCase().includes('por favor')) ? '#10b981' : '#ef4444'}`,
                  color: (!recoveryMsg.toLowerCase().includes('error') && !recoveryMsg.toLowerCase().includes('por favor')) ? '#065f46' : '#b91c1c',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  fontSize: '0.82rem',
                  marginTop: '12px'
                }}>
                  {recoveryMsg}
                </div>
              )}

              <div style={{ borderTop: '1px solid #e5e7eb', marginTop: '14px', paddingTop: '12px', textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => { setAuthRecoveryMode(null); setRecoveryMsg(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--dark-amaranth)', fontSize: '0.84rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  ← Volver a Iniciar Sesión
                </button>
              </div>
            </div>
          ) : authRecoveryMode === 'resend_confirm' ? (
            <div style={{
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: '20px',
              padding: '20px',
              boxShadow: '0 4px 14px rgba(0,0,0,0.05)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Mail size={18} color="var(--dark-amaranth)" /> Reenviar Confirmación
                </h3>
                <button
                  type="button"
                  onClick={() => { setAuthRecoveryMode(null); setRecoveryMsg(''); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', display: 'flex', alignItems: 'center' }}
                  aria-label="Cerrar"
                >
                  <X size={16} />
                </button>
              </div>
              <p style={{ margin: '0 0 16px 0', fontSize: '0.82rem', color: '#4b5563', lineHeight: 1.4 }}>
                ¿No recibiste el correo de confirmación al registrarte? Ingresa tu correo para reenviar el enlace oficial de bienvenida.
              </p>

              <form onSubmit={handleResendConfirmation}>
                <div style={{ marginBottom: '12px' }}>
                  <input
                    type="email"
                    className="form-input-figma"
                    placeholder="Tu correo registrado"
                    value={recoveryEmail}
                    onChange={e => setRecoveryEmail(e.target.value)}
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="btn-primario"
                  style={{ width: '100%', padding: '12px' }}
                  disabled={recoveryLoading}
                >
                  {recoveryLoading ? 'Reenviando...' : 'Reenviar Correo de Confirmación'}
                </button>
              </form>

              {recoveryMsg && (
                <div style={{
                  background: (!recoveryMsg.toLowerCase().includes('error') && !recoveryMsg.toLowerCase().includes('por favor')) ? '#ecfdf5' : '#fee2e2',
                  border: `1px solid ${(!recoveryMsg.toLowerCase().includes('error') && !recoveryMsg.toLowerCase().includes('por favor')) ? '#10b981' : '#ef4444'}`,
                  color: (!recoveryMsg.toLowerCase().includes('error') && !recoveryMsg.toLowerCase().includes('por favor')) ? '#065f46' : '#b91c1c',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  fontSize: '0.82rem',
                  marginTop: '12px'
                }}>
                  {recoveryMsg}
                </div>
              )}

              <div style={{ borderTop: '1px solid #e5e7eb', marginTop: '14px', paddingTop: '12px', textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => { setAuthRecoveryMode(null); setRecoveryMsg(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--dark-amaranth)', fontSize: '0.84rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  ← Volver a Iniciar Sesión
                </button>
              </div>
            </div>
          ) : (
            <div style={{
              background: '#ffffff',
              padding: '4px 0 12px 0'
            }}>
              <form onSubmit={handleLogin}>
                <div style={{ marginBottom: '2px' }}>
                  <input
                    type="email"
                    className="form-input-figma"
                    placeholder="Correo:"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </div>

                {/* Input interactivo con ojo vectorial en color vino */}
                <PasswordInput
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Contraseña:"
                  required
                />

                {/* Verificación de Seguridad Anti-Bot Zero-Trust */}
                <SecurityVerification
                  action="login"
                  onVerify={(_, isValid) => setBotVerified(isValid)}
                />

                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '14px' }}>
                  <button
                    type="submit"
                    className="btn-primario"
                    style={{ minWidth: '170px', padding: '11px 32px', borderRadius: '10px', fontSize: '1rem' }}
                    disabled={loading}
                  >
                    {loading ? 'Ingresando...' : 'Aceptar'}
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', fontSize: '0.78rem' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthRecoveryMode('forgot_password');
                      setRecoveryEmail(email);
                      setRecoveryMsg('');
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--dark-amaranth)', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontWeight: 600 }}
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthRecoveryMode('resend_confirm');
                      setRecoveryEmail(email);
                      setRecoveryMsg('');
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--dark-amaranth)', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontWeight: 600 }}
                  >
                    Reenviar confirmación
                  </button>
                </div>
              </form>

              {errorMsg && (
                <div style={{ background: '#fee2e2', border: '1px solid #ef4444', color: '#b91c1c', padding: '8px 12px', borderRadius: '10px', fontSize: '0.8rem', marginTop: '12px' }}>
                  {errorMsg}
                </div>
              )}

              <div style={{ borderTop: '1px solid #e5e7eb', marginTop: '18px', paddingTop: '14px', textAlign: 'center' }}>
                <Link to="/registro" style={{ color: 'var(--dark-amaranth)', fontSize: '0.86rem', fontWeight: 700, textDecoration: 'none', fontFamily: 'var(--font-display)' }}>
                  ¿No tienes cuenta? Regístrate aquí →
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL PARA RESTABLECER CONTRASEÑA TRAS ENLACE DE RECUPERACIÓN */}
      {showResetModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '24px',
            maxWidth: '440px',
            width: '100%',
            padding: '24px',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.25)'
          }}>
            <h3 style={{ margin: '0 0 6px 0', color: 'var(--dark-amaranth)', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <KeyRound size={20} color="var(--dark-amaranth)" /> Establecer Nueva Contraseña
            </h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '0.82rem', color: '#4b5563', lineHeight: 1.4 }}>
              Has accedido mediante un enlace oficial de recuperación. Por favor ingresa tu nueva contraseña para actualizarla en Supabase.
            </p>

            <form onSubmit={handleApplyRecoveryPassword}>
              <div style={{ marginBottom: '10px' }}>
                <PasswordInput
                  value={recoveryNewPwd}
                  onChange={e => setRecoveryNewPwd(e.target.value)}
                  placeholder="Nueva contraseña (mínimo 6 caracteres)"
                  required
                />
              </div>
              <div style={{ marginBottom: '16px' }}>
                <PasswordInput
                  value={recoveryConfirmPwd}
                  onChange={e => setRecoveryConfirmPwd(e.target.value)}
                  placeholder="Confirmar nueva contraseña"
                  required
                />
              </div>

              {recoveryFeedback && (
                <div style={{
                  background: (!recoveryFeedback.toLowerCase().includes('error') && !recoveryFeedback.toLowerCase().includes('debe') && !recoveryFeedback.toLowerCase().includes('no coinciden')) ? '#ecfdf5' : '#fee2e2',
                  border: `1px solid ${(!recoveryFeedback.toLowerCase().includes('error') && !recoveryFeedback.toLowerCase().includes('debe') && !recoveryFeedback.toLowerCase().includes('no coinciden')) ? '#10b981' : '#ef4444'}`,
                  color: (!recoveryFeedback.toLowerCase().includes('error') && !recoveryFeedback.toLowerCase().includes('debe') && !recoveryFeedback.toLowerCase().includes('no coinciden')) ? '#065f46' : '#b91c1c',
                  padding: '10px',
                  borderRadius: '10px',
                  fontSize: '0.8rem',
                  marginBottom: '14px'
                }}>
                  {recoveryFeedback}
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  className="btn-secundario"
                  style={{ flex: 1, padding: '10px' }}
                  onClick={() => setShowResetModal(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primario"
                  style={{ flex: 1, padding: '10px' }}
                  disabled={recoverySubmitting}
                >
                  {recoverySubmitting ? 'Guardando...' : 'Guardar Clave'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* LISTA DE PASTILLAS DEL MENÚ FIGMA ('user') - Visible cuando está autenticado o en modo Invitado */}
      {(user || !showAuthForm) && (
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
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <span style={{ display: 'block' }}>Mis Pedidos</span>
              <small style={{ color: '#6b7280', fontSize: '0.72rem', fontFamily: 'var(--font-body)' }}>Historial y pedidos en curso</small>
            </div>
            {ultimaOrdenId && (
              <span style={{ background: '#10b981', color: '#fff', fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px', fontWeight: 700 }}>
                En Curso
              </span>
            )}
          </button>

          {/* 2. Favoritos */}
          <button
            type="button"
            className="user-menu-item"
            onClick={() => {
              setModalType('favoritos');
              cargarPlatosFavoritos();
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            <span style={{ flex: 1, textAlign: 'left' }}>Favoritos</span>
          </button>

          {/* 3. Mis direcciones */}
          <button
            type="button"
            className="user-menu-item"
            onClick={() => {
              setDirecciones(addressService.getAddresses());
              setModalType('direcciones');
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div>Mis direcciones</div>
              <small style={{ color: '#6b7280', fontSize: '0.72rem', fontFamily: 'var(--font-body)', display: 'block' }}>
                {direcciones.find(d => d.isDefault)?.alias || 'Múltiples direcciones y terceros'}
              </small>
            </div>
          </button>

          {/* 4. Métodos de pago */}
          <button
            type="button"
            className="user-menu-item"
            onClick={() => setModalType('pagos')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
            <span style={{ flex: 1, textAlign: 'left' }}>Métodos de pago</span>
          </button>

          {/* 5. Mis datos personales */}
          <button
            type="button"
            className="user-menu-item"
            onClick={() => {
              setProfileFeedback('');
              setModalType('datos');
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span style={{ flex: 1, textAlign: 'left' }}>Mis datos personales</span>
          </button>

          {/* 6. Seguridad & Contraseña */}
          <button
            type="button"
            className="user-menu-item"
            onClick={() => {
              setPwdFeedback('');
              setModalType('clave');
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span style={{ flex: 1, textAlign: 'left' }}>Seguridad & Contraseña</span>
          </button>

          {/* 7. Soporte */}
          <button
            type="button"
            className="user-menu-item"
            onClick={() => setModalType('soporte')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span style={{ flex: 1, textAlign: 'left' }}>Soporte</span>
          </button>

          {/* ACCESOS DE ROL PARA PERSONAL */}
          {role === 'restaurant' && (
            <Link to="/cocina" className="user-menu-item" style={{ background: '#fef3c7', borderColor: '#f59e0b', color: '#92400e' }}>
              <ChefHat size={20} color="#92400e" />
              <span style={{ flex: 1, fontWeight: 700 }}>Panel de Cocina</span>
              <span>›</span>
            </Link>
          )}

          {role === 'delivery' && (
            <Link to="/delivery" className="user-menu-item" style={{ background: '#d1fae5', borderColor: '#10b981', color: '#065f46' }}>
              <Bike size={20} color="#065f46" />
              <span style={{ flex: 1, fontWeight: 700 }}>Panel de Repartidor</span>
              <span>›</span>
            </Link>
          )}

          {role === 'admin' && (
            <Link to="/admin" className="user-menu-item" style={{ background: '#ede9fe', borderColor: '#8b5cf6', color: '#5b21b6' }}>
              <Shield size={20} color="#5b21b6" />
              <span style={{ flex: 1, fontWeight: 700 }}>Panel Administrador</span>
              <span>›</span>
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
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span style={{ flex: 1, textAlign: 'left' }}>Cerrar Sesión</span>
            </button>
          )}

        </nav>
      )}

      {/* =========================================================================
          VISTA FULL-SCREEN: MIS PEDIDOS (FIGMA Screenshot 225228)
          ========================================================================= */}
      {modalType === 'pedidos' && (
        <div className="detail-figma-screen" style={{ paddingBottom: '86px' }}>
          {/* Header Plano Dark Amaranth */}
          <header className="figma-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1 className="figma-header-title" style={{ fontSize: '1.5rem' }}>
              Mis Pedidos
            </h1>
            <button
              type="button"
              onClick={() => setModalType(null)}
              style={{
                background: 'rgba(255,255,255,0.16)',
                border: 'none',
                color: '#ffffff',
                borderRadius: '999px',
                padding: '6px 14px',
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '0.84rem',
                cursor: 'pointer'
              }}
            >
              ← Volver
            </button>
          </header>

          <div style={{ padding: '18px 20px' }}>
            {loadingHistorial ? (
              <p style={{ color: 'var(--dark-amaranth)', textAlign: 'center', padding: '40px 20px', fontWeight: 700 }}>
                Cargando historial de pedidos...
              </p>
            ) : historialOrdenes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '50px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
                  <ShoppingBag size={48} color="var(--dark-amaranth)" />
                </div>
                <p style={{ color: 'var(--dark-amaranth)', fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 700 }}>
                  Aún no has realizado pedidos
                </p>
                <Link to="/" onClick={() => setModalType(null)} className="btn-primario" style={{ display: 'inline-block', marginTop: '12px' }}>
                  Explorar Catálogo
                </Link>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                {historialOrdenes.map(ord => {
                  const items = Array.isArray(ord.items) ? ord.items : [];
                  const primerItem = items[0] || {};
                  const f = new Date(ord.created_at);
                  const fechaStr = `${f.toLocaleDateString()} ${f.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                  const resumenTitulo = items.length > 1
                    ? `${primerItem.name || 'Pedido'} (+${items.length - 1})`
                    : (primerItem.name || `#ORD-${(ord.id || '').slice(0, 6)}`);

                  return (
                    <div
                      key={ord.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}
                    >
                      {/* Tarjeta de Imagen Gris / Foto del Pedido (Screenshot 225228) */}
                      <div
                        onClick={() => {
                          setModalType(null);
                          navigate(`/tracking?order_id=${ord.id}`);
                        }}
                        style={{
                          width: '100%',
                          aspectRatio: '4 / 3',
                          borderRadius: '14px',
                          backgroundColor: '#dcdcdc',
                          overflow: 'hidden',
                          position: 'relative',
                          cursor: 'pointer'
                        }}
                      >
                        <img
                          src={getProductImageUrl({ image_url: primerItem.image_url, name: primerItem.name })}
                          alt={resumenTitulo}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={e => { e.target.style.display = 'none'; }}
                        />
                        <span style={{
                          position: 'absolute',
                          top: '6px',
                          left: '6px',
                          fontSize: '0.65rem',
                          fontWeight: 800,
                          padding: '2px 7px',
                          borderRadius: '999px',
                          background: ord.status === 'delivered' ? '#10b981' : ord.status === 'cancelled' ? '#ef4444' : 'var(--golden-orange)',
                          color: ord.status === 'delivered' || ord.status === 'cancelled' ? '#ffffff' : '#111827'
                        }}>
                          {ord.status === 'delivered' ? 'Entregado' : ord.status === 'cancelled' ? 'Cancelado' : 'En Curso'}
                        </span>
                      </div>

                      {/* Texto debajo idéntico al diseño: Plato / Precio en Dark Amaranth */}
                      <div>
                        <div style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: '0.84rem',
                          fontWeight: 700,
                          color: 'var(--dark-amaranth)',
                          lineHeight: 1.25
                        }}>
                          {resumenTitulo}
                        </div>
                        <div style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: '0.86rem',
                          fontWeight: 700,
                          color: 'var(--dark-amaranth)'
                        }}>
                          {formatUsd(ord.total)}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: '#6b7280', marginBottom: '6px' }}>
                          {fechaStr} • {ord.businesses?.name?.replace('Tropicalia ', '') || 'Tropicalia'}
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setModalType(null);
                              navigate(`/tracking?order_id=${ord.id}`);
                            }}
                            style={{
                              flex: 1,
                              background: '#dedede',
                              border: 'none',
                              color: 'var(--dark-amaranth)',
                              borderRadius: '8px',
                              padding: '4px 6px',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                          >
                            Ver
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRepetirPedido(ord)}
                            style={{
                              flex: 1,
                              background: 'var(--dark-amaranth)',
                              border: 'none',
                              color: '#ffffff',
                              borderRadius: '8px',
                              padding: '4px 6px',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                          >
                            Repetir
                          </button>
                        </div>
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
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <HeartOutlineIcon size={18} active={true} /> Mis Platos Favoritos
              </h3>
              <button onClick={() => setModalType(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={16} />
              </button>
            </div>

            {loadingFavoritos ? (
              <p style={{ color: '#6b7280', textAlign: 'center', padding: '20px' }}>Cargando favoritos...</p>
            ) : platosFavoritos.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                  <HeartOutlineIcon size={38} active={false} color="#9ca3af" />
                </div>
                <p style={{ color: '#6b7280', marginTop: '10px' }}>No tienes platos favoritos guardados aún.</p>
                <small style={{ color: '#9ca3af' }}>Toca el icono de favorito en cualquier plato del catálogo para guardarlo aquí.</small>
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
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <MapPin size={18} color="var(--dark-amaranth)" /> Mis Direcciones de Entrega
              </h3>
              <button onClick={() => setModalType(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={16} />
              </button>
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
                        {addr.alias}
                      </strong>
                      {addr.esTercero && (
                        <span style={{ background: '#fdf2f8', color: 'var(--dark-amaranth)', fontSize: '0.68rem', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                          Tercero
                        </span>
                      )}
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
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="Eliminar dirección"
                      aria-label="Eliminar dirección"
                    >
                      <TrashVinoIcon size={16} />
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
                  <button type="button" onClick={() => setShowAddAddressForm(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center' }} aria-label="Cerrar formulario"><X size={16} /></button>
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
                    ¿Es un envío para otra persona (Tercero)?
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
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <User size={18} color="var(--dark-amaranth)" /> Mis Datos Personales
              </h3>
              <button onClick={() => setModalType(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={16} />
              </button>
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
                      Por seguridad, ingresa tu contraseña actual para confirmar el cambio de correo o teléfono:
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
                    Tu rol está protegido e inmutable por las políticas de seguridad del backend.
                  </small>
                </div>

                {profileFeedback && (
                  <div style={{
                    fontSize: '0.82rem',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: (!profileFeedback.toLowerCase().includes('error')) ? '#ecfdf5' : '#fee2e2',
                    border: `1px solid ${(!profileFeedback.toLowerCase().includes('error')) ? '#10b981' : '#ef4444'}`,
                    color: (!profileFeedback.toLowerCase().includes('error')) ? '#065f46' : '#b91c1c'
                  }}>
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
          MODAL 5: CAMBIO SEGURO DE CONTRASEÑA
          ========================================================================= */}
      {modalType === 'clave' && (
        <div className="modal-figma-overlay" onClick={() => setModalType(null)}>
          <div className="modal-figma-sheet" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <KeyRound size={18} color="var(--dark-amaranth)" /> Cambio Seguro de Contraseña
              </h3>
              <button onClick={() => setModalType(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={16} />
              </button>
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
                <div style={{
                  fontSize: '0.82rem',
                  padding: '10px',
                  borderRadius: '8px',
                  background: (!pwdFeedback.toLowerCase().includes('error')) ? '#ecfdf5' : '#fee2e2',
                  border: `1px solid ${(!pwdFeedback.toLowerCase().includes('error')) ? '#10b981' : '#ef4444'}`,
                  color: (!pwdFeedback.toLowerCase().includes('error')) ? '#065f46' : '#b91c1c'
                }}>
                  {pwdFeedback}
                </div>
              )}

              <button
                type="submit"
                disabled={pwdSubmitting}
                className="btn-primario"
                style={{ width: '100%', padding: '12px', marginTop: '6px' }}
              >
                {pwdSubmitting ? 'Verificando y enviando...' : 'Enviar Verificación por Correo'}
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
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CreditCard size={18} color="var(--dark-amaranth)" /> Métodos de Pago Aceptados
              </h3>
              <button onClick={() => setModalType(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
              <div style={{ padding: '10px', background: '#f3f4f6', borderRadius: '10px' }}>
                <strong>Pago Móvil (Bs.)</strong> • Tasa oficial BCV. Banesco, Venezuela, Mercantil.
              </div>
              <div style={{ padding: '10px', background: '#f3f4f6', borderRadius: '10px' }}>
                <strong>Binance Pay (USDT)</strong> • Pagos instantáneos sin comisiones.
              </div>
              <div style={{ padding: '10px', background: '#f3f4f6', borderRadius: '10px' }}>
                <strong>Zelle & Zinli (USD)</strong> • Dólares digitales acreditados al instante.
              </div>
              <div style={{ padding: '10px', background: '#f3f4f6', borderRadius: '10px' }}>
                <strong>Efectivo & Punto de Venta</strong> • Contra entrega en mostrador o delivery.
              </div>
            </div>
            <button onClick={() => setModalType(null)} className="btn-primario" style={{ width: '100%', marginTop: '14px' }}>
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 7: SOPORTE OFICIAL (WHATSAPP)
          ========================================================================= */}
      {modalType === 'soporte' && (
        <div className="modal-figma-overlay" onClick={() => setModalType(null)}>
          <div className="modal-figma-sheet" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Headphones size={20} color="var(--dark-amaranth)" /> Atención y Soporte
              </h3>
              <button onClick={() => setModalType(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={16} />
              </button>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#4b5563', margin: '0 0 16px 0' }}>
              Canal oficial de atención comercial, pedidos y soporte al cliente de Tropicalia CRB.
            </p>
            <a
              href="https://wa.me/584141352503?text=Hola%20Tropicalia,%20necesito%20asistencia%20con%20mi%20cuenta"
              target="_blank"
              rel="noreferrer"
              className="btn-primario"
              style={{
                width: '100%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                textAlign: 'center',
                background: '#25D366',
                color: '#ffffff',
                textDecoration: 'none',
                padding: '12px',
                fontWeight: 800,
                boxSizing: 'border-box'
              }}
            >
              <WhatsAppIcon size={20} color="#ffffff" />
              <span>Chatear por WhatsApp</span>
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
