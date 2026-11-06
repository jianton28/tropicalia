import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { fetchTasaBCV, formatBs } from '../../services/bcvService';
import logoImg from '../../assets/logo.png';

export default function Navbar() {
  const { user, role } = useAuth();
  const { totalCount } = useCart();
  const [tasaBCV, setTasaBCV] = useState(null);
  const location = useLocation();

  useEffect(() => {
    fetchTasaBCV().then(rate => setTasaBCV(rate));
  }, []);

  const isAdmin = role === 'admin';
  const isKitchen = role === 'restaurant';
  const isDelivery = role === 'delivery';

  return (
    <header className="global-navbar">
      <div className="navbar-inner-wrapper">
        {/* Brand & Mascota Oficial */}
        <Link to="/" className="navbar-brand-link" title="Ir al Inicio • Tropicalia">
          <img 
            src={logoImg} 
            alt="Mascota Tropicalia" 
            className="navbar-mascot-img"
          />
          <div className="navbar-brand-text">
            <span className="navbar-title">Tropicalia</span>
            <span className="navbar-subtitle">FOOD DELIVERY</span>
          </div>
        </Link>

        {/* Píldora Flotante con Tasa Oficial BCV */}
        <div className="navbar-bcv-badge" title="Tasa de Cambio Oficial Banco Central de Venezuela">
          <span className="bcv-dot"></span>
          <span className="bcv-text">
            BCV: <strong>{tasaBCV ? formatBs(tasaBCV) : 'Cargando...'}</strong>
          </span>
        </div>

        {/* Accesos Rápidos de Rol, Perfil y Carrito */}
        <div className="navbar-actions">
          {/* Botón de Acceso Rápido al Panel Admin (Rol Admin) */}
          {isAdmin && (
            <Link 
              to="/admin" 
              className={`navbar-role-pill admin-badge ${location.pathname === '/admin' ? 'active-role' : ''}`}
              title="Consola Administrativa de Control Total"
            >
              <span className="role-icon">🛡️</span>
              <span className="role-label">Admin</span>
            </Link>
          )}

          {/* Acceso Cocina */}
          {isKitchen && (
            <Link 
              to="/cocina" 
              className={`navbar-role-pill kitchen-badge ${location.pathname === '/cocina' ? 'active-role' : ''}`}
              title="Panel Operativo de Cocina"
            >
              <span className="role-icon">👨‍🍳</span>
              <span className="role-label">Cocina</span>
            </Link>
          )}

          {/* Acceso Delivery */}
          {isDelivery && (
            <Link 
              to="/delivery" 
              className={`navbar-role-pill delivery-badge ${location.pathname === '/delivery' ? 'active-role' : ''}`}
              title="Panel de Repartos y Billetera"
            >
              <span className="role-icon">🛵</span>
              <span className="role-label">Repartos</span>
            </Link>
          )}

          {/* Perfil de Usuario o Iniciar Sesión */}
          {!user ? (
            <Link to="/portal" className="navbar-auth-btn" title="Iniciar Sesión / Registrarse">
              Ingresar
            </Link>
          ) : (
            !isAdmin && !isKitchen && !isDelivery && (
              <Link to="/portal" className="navbar-user-btn" title="Mi Cuenta y Direcciones">
                👤 {user.user_metadata?.full_name?.split(' ')[0] || 'Mi Cuenta'}
              </Link>
            )
          )}

          {/* Contador Interactivo del Carrito de Compras */}
          <Link 
            to="/checkout" 
            className={`navbar-cart-button ${totalCount > 0 ? 'cart-has-items' : ''}`}
            aria-label={`Ver carrito de compras con ${totalCount} productos`}
            title="Ir al Carrito / Confirmar Pedido"
          >
            <span className="cart-icon">🛒</span>
            <span className="cart-count-badge">{totalCount}</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
