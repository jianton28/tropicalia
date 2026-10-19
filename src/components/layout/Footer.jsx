import React from 'react';
import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer style={{
      textAlign: 'center',
      padding: '25px 15px',
      borderTop: '1px solid #222',
      fontSize: '0.8rem',
      color: '#737373',
      marginTop: '60px'
    }}>
      <p style={{ margin: '0 0 6px 0' }}>Tropicalia © 2026 • Plataforma de Intermediación Gastronómica</p>
      <p style={{ margin: 0 }}>
        Consulta nuestros{' '}
        <Link to="/legal" style={{ color: 'var(--gold)', textDecoration: 'underline' }}>
          Términos y Condiciones de Servicio
        </Link>
      </p>
    </footer>
  );
}

