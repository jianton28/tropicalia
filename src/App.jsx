import React, { useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Navbar from './components/layout/Navbar';
import BottomDock from './components/layout/BottomDock';
import ProtectedRoute from './components/layout/ProtectedRoute';

import Home from './pages/Home';
import Checkout from './pages/Checkout';
import Tracking from './pages/Tracking';
import Portal from './pages/Portal';
import Registro from './pages/Registro';
import Cocina from './pages/Cocina';
import Delivery from './pages/Delivery';
import Admin from './pages/Admin';
import Legal from './pages/Legal';

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);

  const isStaffRoute = ['/cocina', '/delivery', '/admin'].includes(location.pathname);
  const showBottomDock = ['/', '/portal', '/tracking', '/checkout', '/registro'].includes(location.pathname);

  function handleSearchClick() {
    if (location.pathname !== '/') {
      navigate('/?focusSearch=1');
      setSearchOpen(true);
    } else {
      setSearchOpen(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => {
        const input = document.getElementById('global-search-input');
        if (input) input.focus();
      }, 150);
    }
  }

  return (
    <div className="app-shell">
      <div className={`app-container ${isStaffRoute ? 'wide-layout' : ''}`}>
        {/* Navbar superior en rutas de administración / cocina / repartidores */}
        {isStaffRoute && <Navbar />}

        <div style={{ flex: 1 }}>
          <Routes>
            {/* Rutas Públicas */}
            <Route
              path="/"
              element={
                <Home
                  searchOpen={searchOpen}
                  onTriggerSearch={() => setSearchOpen(true)}
                />
              }
            />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/tracking" element={<Tracking />} />
            <Route path="/portal" element={<Portal />} />
            <Route path="/bienvenida" element={<Navigate to="/portal?welcome=1" replace />} />
            <Route path="/welcome" element={<Navigate to="/portal?welcome=1" replace />} />
            <Route path="/registro" element={<Registro />} />
            <Route path="/legal" element={<Legal />} />
            <Route path="/terminos" element={<Legal />} />
            <Route path="/privacidad" element={<Legal />} />
            <Route path="/terminos-y-condiciones" element={<Legal />} />

            {/* Rutas Protegidas por Rol */}
            <Route
              path="/cocina"
              element={
                <ProtectedRoute allowedRoles={['restaurant', 'admin']}>
                  <Cocina />
                </ProtectedRoute>
              }
            />
            <Route
              path="/delivery"
              element={
                <ProtectedRoute allowedRoles={['delivery', 'admin']}>
                  <Delivery />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <Admin />
                </ProtectedRoute>
              }
            />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>

        {/* Bottom Navigation Dock Oficial Figma */}
        {showBottomDock && <BottomDock onSearchClick={handleSearchClick} />}
      </div>
    </div>
  );
}
