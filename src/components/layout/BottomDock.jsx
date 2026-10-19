import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';

export default function BottomDock({ onSearchClick }) {
  const location = useLocation();

  // Ocultar dock en vistas de administración interna si se prefiere,
  // pero dejar visible en vistas de cliente (Home, Tracking, Checkout, Portal)
  const isHome = location.pathname === '/';
  const isPortal = location.pathname === '/portal';
  const isTracking = location.pathname === '/tracking';

  return (
    <nav className="figma-bottom-dock" aria-label="Navegación inferior">
      {/* Botón Buscar / Explorar */}
      <button
        type="button"
        className={`dock-item ${isHome ? 'active' : ''}`}
        onClick={onSearchClick}
        title="Buscar y Explorar"
        aria-label="Buscar platos"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
      </button>

      {/* Botón Central Elevado - Home */}
      <NavLink
        to="/"
        className={({ isActive }) => `dock-center-notch ${isActive ? 'active-notch' : ''}`}
        title="Inicio"
        aria-label="Ir al Inicio"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
      </NavLink>

      {/* Botón Perfil / Usuario */}
      <NavLink
        to="/portal"
        className={({ isActive }) => `dock-item ${isActive ? 'active' : ''}`}
        title="Mi Perfil"
        aria-label="Mi Perfil"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </NavLink>
    </nav>
  );
}

