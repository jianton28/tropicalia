import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

export default function Portal() {
  const navigate = useNavigate();
  const { user, role, signIn, signOut } = useAuth();

  // Estados de inicio de sesión si no está autenticado
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAuthForm, setShowAuthForm] = useState(!user);

  // Modales de información Figma
  const [modalType, setModalType] = useState(null); // 'direcciones' | 'pagos' | 'datos' | 'soporte' | null

  // Datos del usuario
  const [savedAddress, setSavedAddress] = useState(() => {
    return localStorage.getItem('tropicalia_delivery_address') || 'Av. Las Delicias, Edif. Torre';
  });
  const [tempAddress, setTempAddress] = useState(savedAddress);

  const [ultimaOrdenId, setUltimaOrdenId] = useState(null);

  useEffect(() => {
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
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      const res = await signIn(email.trim(), password);
      setLoading(false);
      setShowAuthForm(false);
      if (res.role === 'restaurant') navigate('/cocina');
      else if (res.role === 'delivery') navigate('/delivery');
      else if (res.role === 'admin') navigate('/admin');
    } catch (err) {
      setErrorMsg('Error al iniciar sesión: ' + err.message);
      setLoading(false);
    }
  }

  function handleSaveAddress(e) {
    e.preventDefault();
    if (tempAddress.trim()) {
      setSavedAddress(tempAddress.trim());
      localStorage.setItem('tropicalia_delivery_address', tempAddress.trim());
      setModalType(null);
    }
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

      {/* FORMULARIO DE INICIO DE SESIÓN / REGISTRO SI NO ESTÁ AUTENTICADO */}
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
              <input
                type="email"
                className="form-input-figma"
                placeholder="Correo electrónico"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
              <input
                type="password"
                className="form-input-figma"
                placeholder="Contraseña"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
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
        
        {/* Mis Pedidos */}
        <Link
          to={ultimaOrdenId ? `/tracking?order_id=${ultimaOrdenId}` : '/tracking'}
          className="user-menu-item"
        >
          <span style={{ fontSize: '1.25rem' }}>📦</span>
          <span style={{ flex: 1 }}>Mis Pedidos</span>
          {ultimaOrdenId && (
            <span style={{ background: '#10b981', color: '#fff', fontSize: '0.72rem', padding: '3px 8px', borderRadius: '999px', fontWeight: 800 }}>
              En Curso
            </span>
          )}
          <span style={{ color: '#9ca3af' }}>›</span>
        </Link>

        {/* Favoritos */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => alert('¡Tus platos favoritos estarán listados aquí próximamente!')}
        >
          <span style={{ fontSize: '1.25rem' }}>❤️</span>
          <span style={{ flex: 1, textAlign: 'left' }}>Favoritos</span>
          <span style={{ color: '#9ca3af' }}>›</span>
        </button>

        {/* Mis Direcciones */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => {
            setTempAddress(savedAddress);
            setModalType('direcciones');
          }}
        >
          <span style={{ fontSize: '1.25rem' }}>📍</span>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div>Mis direcciones</div>
            <small style={{ color: '#6b7280', fontSize: '0.75rem', display: 'block' }}>
              {savedAddress}
            </small>
          </div>
          <span style={{ color: '#9ca3af' }}>›</span>
        </button>

        {/* Métodos de Pago */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => setModalType('pagos')}
        >
          <span style={{ fontSize: '1.25rem' }}>💳</span>
          <span style={{ flex: 1, textAlign: 'left' }}>Métodos de pago</span>
          <span style={{ color: '#9ca3af' }}>›</span>
        </button>

        {/* Mis Datos Personales */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => setModalType('datos')}
        >
          <span style={{ fontSize: '1.25rem' }}>👤</span>
          <span style={{ flex: 1, textAlign: 'left' }}>Mis datos personales</span>
          <span style={{ color: '#9ca3af' }}>›</span>
        </button>

        {/* Soporte */}
        <button
          type="button"
          className="user-menu-item"
          onClick={() => setModalType('soporte')}
        >
          <span style={{ fontSize: '1.25rem' }}>🎧</span>
          <span style={{ flex: 1, textAlign: 'left' }}>Soporte</span>
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

      {/* MODAL FIGMA - DIRECCIONES */}
      {modalType === 'direcciones' && (
        <div className="modal-figma-overlay" onClick={() => setModalType(null)}>
          <div className="modal-figma-sheet" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)' }}>📍 Mis Direcciones</h3>
              <button onClick={() => setModalType(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer' }}>✕</button>
            </div>
            <form onSubmit={handleSaveAddress}>
              <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0 0 10px 0' }}>
                Dirección actual para tus entregas en Tropicalia:
              </p>
              <input
                type="text"
                className="form-input-figma"
                value={tempAddress}
                onChange={e => setTempAddress(e.target.value)}
                placeholder="Av. Las Delicias, Edif. Torre..."
                required
              />
              <button type="submit" className="btn-primario" style={{ width: '100%', marginTop: '6px' }}>
                Guardar Dirección
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL FIGMA - MÉTODOS DE PAGO */}
      {modalType === 'pagos' && (
        <div className="modal-figma-overlay" onClick={() => setModalType(null)}>
          <div className="modal-figma-sheet" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)' }}>💳 Métodos de Pago Aceptados</h3>
              <button onClick={() => setModalType(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.88rem' }}>
              <div style={{ padding: '12px', background: '#f3f4f6', borderRadius: '12px' }}>
                <strong>📱 Pago Móvil (Bs.)</strong>
                <p style={{ margin: '4px 0 0 0', color: '#4b5563', fontSize: '0.82rem' }}>
                  Banco Banesco / Mercantil / Venezuela. Tasa oficial BCV.
                </p>
              </div>
              <div style={{ padding: '12px', background: '#f3f4f6', borderRadius: '12px' }}>
                <strong>🟡 Binance Pay (USDT)</strong>
                <p style={{ margin: '4px 0 0 0', color: '#4b5563', fontSize: '0.82rem' }}>
                  Pagos instantáneos sin comisiones mediante Binance Pay ID.
                </p>
              </div>
              <div style={{ padding: '12px', background: '#f3f4f6', borderRadius: '12px' }}>
                <strong>🟣 Zelle & Zinli (USD)</strong>
                <p style={{ margin: '4px 0 0 0', color: '#4b5563', fontSize: '0.82rem' }}>
                  Acreditación directa en dólares digitales.
                </p>
              </div>
              <div style={{ padding: '12px', background: '#f3f4f6', borderRadius: '12px' }}>
                <strong>💵 Efectivo & Punto de Venta</strong>
                <p style={{ margin: '4px 0 0 0', color: '#4b5563', fontSize: '0.82rem' }}>
                  Paga contra entrega en divisas o con punto inalámbrico.
                </p>
              </div>
            </div>
            <button onClick={() => setModalType(null)} className="btn-primario" style={{ width: '100%', marginTop: '16px' }}>
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* MODAL FIGMA - DATOS PERSONALES */}
      {modalType === 'datos' && (
        <div className="modal-figma-overlay" onClick={() => setModalType(null)}>
          <div className="modal-figma-sheet" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)' }}>👤 Mis Datos Personales</h3>
              <button onClick={() => setModalType(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer' }}>✕</button>
            </div>
            {user ? (
              <div style={{ fontSize: '0.88rem', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <span style={{ color: '#6b7280', fontSize: '0.78rem', display: 'block' }}>Nombre Completo</span>
                  <strong>{user.user_metadata?.full_name || 'No especificado'}</strong>
                </div>
                <div>
                  <span style={{ color: '#6b7280', fontSize: '0.78rem', display: 'block' }}>Correo Electrónico</span>
                  <strong>{user.email}</strong>
                </div>
                <div>
                  <span style={{ color: '#6b7280', fontSize: '0.78rem', display: 'block' }}>Teléfono</span>
                  <strong>{user.user_metadata?.phone || '+58 412 000 0000'}</strong>
                </div>
                <div>
                  <span style={{ color: '#6b7280', fontSize: '0.78rem', display: 'block' }}>Rol de Usuario</span>
                  <span style={{ textTransform: 'capitalize', fontWeight: 700, color: 'var(--dark-amaranth)' }}>{role}</span>
                </div>
              </div>
            ) : (
              <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>
                Inicia sesión para gestionar tus datos personales y direcciones de entrega.
              </p>
            )}
            <button onClick={() => setModalType(null)} className="btn-primario" style={{ width: '100%', marginTop: '16px' }}>
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* MODAL FIGMA - SOPORTE */}
      {modalType === 'soporte' && (
        <div className="modal-figma-overlay" onClick={() => setModalType(null)}>
          <div className="modal-figma-sheet" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)' }}>🎧 Atención y Soporte</h3>
              <button onClick={() => setModalType(null)} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer' }}>✕</button>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#4b5563', margin: '0 0 16px 0' }}>
              ¿Tienes dudas con un pedido o pago? Nuestro equipo de conciliación y atención al cliente está activo.
            </p>
            <a
              href="https://wa.me/584120000000?text=Hola%20Tropicalia,%20necesito%20asistencia%20con%20un%20pedido"
              target="_blank"
              rel="noreferrer"
              className="btn-primario"
              style={{ width: '100%', display: 'block', textAlign: 'center', background: '#25D366' }}
            >
              💬 Chatear por WhatsApp
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
