import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';
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
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar />
      <div style={{ flex: 1 }}>
        <Routes>
          {/* Rutas Públicas */}
          <Route path="/" element={<Home />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/tracking" element={<Tracking />} />
          <Route path="/portal" element={<Portal />} />
          <Route path="/registro" element={<Registro />} />
          <Route path="/legal" element={<Legal />} />

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
      <Footer />
    </div>
  );
}

