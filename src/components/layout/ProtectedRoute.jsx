import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function ProtectedRoute({ children, allowedRoles }) {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
        <p>Verificando credenciales...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/portal" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    return (
      <div className="container" style={{ textAlign: 'center', marginTop: '60px' }}>
        <div className="card" style={{ maxWidth: '480px', margin: '0 auto', borderColor: 'var(--red)' }}>
          <h2 style={{ color: '#fca5a5' }}>Acceso Restringido</h2>
          <p style={{ color: 'var(--text-muted)' }}>
            No tienes los permisos necesarios para acceder a este panel.
          </p>
          <a href="/" className="btn-primario" style={{ marginTop: '12px' }}>
            Volver a la Tienda
          </a>
        </div>
      </div>
    );
  }

  return children;
}

