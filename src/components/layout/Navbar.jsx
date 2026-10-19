import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { fetchTasaBCV, formatBs } from '../../services/bcvService';

export default function Navbar() {
  const { user, role } = useAuth();
  const { totalCount } = useCart();
  const [tasaBCV, setTasaBCV] = useState(null);

  useEffect(() => {
    fetchTasaBCV().then(rate => setTasaBCV(rate));
  }, []);

  function renderAuthButton() {
    if (!user) {
      return (
        <Link to="/portal" className="btn-secundario">
          Iniciar Sesión
        </Link>
      );
    }

    if (role === 'restaurant') {
      return (
        <Link to="/cocina" className="btn-secundario" style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}>
          👨‍🍳 Panel Cocina
        </Link>
      );
    }

    if (role === 'delivery') {
      return (
        <Link to="/delivery" className="btn-secundario" style={{ borderColor: 'var(--green)', color: '#34d399' }}>
          🛵 Panel Delivery
        </Link>
      );
    }

    if (role === 'admin') {
      return (
        <Link to="/admin" className="btn-secundario" style={{ borderColor: 'var(--indigo)', color: '#818cf8' }}>
          🛡️ Panel Admin
        </Link>
      );
    }

    const firstName = user.user_metadata?.full_name?.split(' ')[0] || 'Mi Cuenta';
    return (
      <Link to="/portal" className="btn-secundario">
        👤 {firstName}
      </Link>
    );
  }

  return (
    <nav className="navbar">
      <div className="container navbar-content">
        <div className="brand-box">
          <Link to="/" className="brand-title">Tropicalia</Link>
          <span className="bcv-pill">
            💵 BCV: {tasaBCV ? formatBs(tasaBCV) : 'Cargando...'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {renderAuthButton()}
          <Link to="/checkout" className="btn-primario" style={{ padding: '8px 14px' }}>
            🛒 ({totalCount})
          </Link>
        </div>
      </div>
    </nav>
  );
}

