import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Portal() {
  const navigate = useNavigate();
  const { user, role, signIn, signOut } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const ultimaOrdenId = localStorage.getItem('tropicalia_last_order_id');

  // Si ya tiene sesión activa y es cocina, delivery o admin, redirigir automáticamente
  React.useEffect(() => {
    if (user && role) {
      if (role === 'restaurant') navigate('/cocina');
      else if (role === 'delivery') navigate('/delivery');
      else if (role === 'admin') navigate('/admin');
    }
  }, [user, role, navigate]);

  async function handleLogin(e) {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      const res = await signIn(email.trim(), password);
      if (res.role === 'restaurant') navigate('/cocina');
      else if (res.role === 'delivery') navigate('/delivery');
      else if (res.role === 'admin') navigate('/admin');
      else navigate('/');
    } catch (err) {
      setErrorMsg('Error al iniciar sesión: ' + err.message);
      setLoading(false);
    }
  }

  // Vista de cuenta de cliente si ya está autenticado
  if (user && role === 'client') {
    return (
      <div className="container" style={{ maxWidth: '440px', marginTop: '60px', marginBottom: '60px' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>👤</div>
          <h3 style={{ margin: 0, color: 'var(--gold)' }}>
            {user.user_metadata?.full_name || 'Cliente Tropicalia'}
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 18px 0' }}>
            {user.email}
          </p>

          {ultimaOrdenId && (
            <Link
              to={`/tracking?order_id=${ultimaOrdenId}`}
              className="btn-primario"
              style={{ width: '100%', marginBottom: '10px', background: '#10b981' }}
            >
              🛵 Ver mi Pedido en Curso
            </Link>
          )}

          <Link to="/" className="btn-primario" style={{ width: '100%', marginBottom: '10px' }}>
            🍔 Ir al Catálogo de Restaurantes
          </Link>

          <button
            onClick={() => signOut()}
            className="btn-secundario"
            style={{ width: '100%', borderColor: 'var(--red)', color: '#fca5a5', marginTop: '8px' }}
          >
            Cerrar Sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: '440px', marginTop: '60px', marginBottom: '60px' }}>
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <Link to="/" style={{ color: 'var(--gold)', textDecoration: 'none', fontSize: '0.85rem' }}>
          ← Volver al Catálogo
        </Link>
        <h1 style={{ fontSize: '1.9rem', margin: '8px 0 4px 0', color: '#fff' }}>Tropicalia</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
          Acceso unificado para Clientes, Aliados y Repartidores
        </p>
      </div>

      <div className="card">
        <form onSubmit={handleLogin}>
          <label>Correo Electrónico:</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            placeholder="tucorreo@tropicalia.com"
          />

          <label>Contraseña:</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            placeholder="••••••••"
          />

          <button
            type="submit"
            className="btn-primario"
            style={{ width: '100%', marginTop: '6px', padding: '12px' }}
            disabled={loading}
          >
            {loading ? 'Verificando...' : 'Ingresar a mi Cuenta'}
          </button>
        </form>

        {errorMsg && (
          <div style={{
            background: 'rgba(239,68,68,0.15)',
            border: '1px solid var(--red)',
            color: '#fca5a5',
            padding: '10px',
            borderRadius: '8px',
            fontSize: '0.85rem',
            marginTop: '12px'
          }}>
            {errorMsg}
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '20px', paddingTop: '16px', textAlign: 'center' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 10px 0' }}>
            ¿Aún no tienes cuenta en Tropicalia?
          </p>
          <Link
            to="/registro"
            className="btn-secundario"
            style={{ width: '100%', borderColor: 'var(--gold)', color: 'var(--gold)', display: 'block' }}
          >
            ✨ Crear Cuenta (Cliente, Cocina o Delivery)
          </Link>
        </div>
      </div>
    </div>
  );
}

