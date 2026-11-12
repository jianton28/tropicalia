import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';

export default function BottomDock({ onSearchClick }) {
  const location = useLocation();

  const isHome = location.pathname === '/';
  const isPortal = location.pathname === '/portal';

  return (
    <nav className="figma-bottom-dock" aria-label="Navegación inferior oficial Tropicalia">
      {/* Botón Buscar (Ícono Lupa en Cuadro Redondeado - Diseño Aprobado) */}
      <button
        type="button"
        className="dock-item"
        onClick={onSearchClick}
        title="Buscar platos y restaurantes"
        aria-label="Buscar"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="4.5" />
          <circle cx="10.8" cy="10.8" r="3.6" />
          <line x1="13.5" y1="13.5" x2="16.8" y2="16.8" />
        </svg>
      </button>

      {/* Botón Inicio (Casa Pentágono con guion interior - Diseño Aprobado) */}
      <NavLink
        to="/"
        className={`dock-item ${isHome ? 'dock-active-circle' : ''}`}
        title="Inicio"
        aria-label="Ir al Inicio"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 10.2 L12 4 L19.5 10.2 V18.2 C19.5 19.2 18.7 20 17.7 20 H6.3 C5.3 20 4.5 19.2 4.5 18.2 Z" />
          <line x1="10" y1="16" x2="14" y2="16" />
        </svg>
      </NavLink>

      {/* Botón Perfil / Usuario (Silueta dentro de Círculo - Diseño Aprobado) */}
      <NavLink
        to="/portal"
        className={`dock-item ${isPortal ? 'dock-active-circle' : ''}`}
        title="Mi Perfil"
        aria-label="Mi Perfil"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9.2" />
          <circle cx="12" cy="9.4" r="3" />
          <path d="M6.8 18.8 C7.7 15.8 9.7 14.6 12 14.6 C14.3 14.6 16.3 15.8 17.2 18.8" />
        </svg>
      </NavLink>
    </nav>
  );
}
