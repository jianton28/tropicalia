import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export default function Registro() {
  const navigate = useNavigate();
  const { signUp } = useAuth();

  const [rol, setRol] = useState('client');
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [password, setPassword] = useState('');

  // Campos específicos de Cocina
  const [localNombre, setLocalNombre] = useState('');
  const [localCategoria, setLocalCategoria] = useState('Comida Rápida');
  const [localRif, setLocalRif] = useState('');

  // Campos específicos de Delivery
  const [vehiculoTipo, setVehiculoTipo] = useState('moto');
  const [vehiculoPlaca, setVehiculoPlaca] = useState('');

  // Archivos de recaudo
  const [permisoSanitario, setPermisoSanitario] = useState(null);
  const [driverCedula, setDriverCedula] = useState(null);
  const [driverLicencia, setDriverLicencia] = useState(null);

  const [tycAccepted, setTycAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function uploadRecaudo(file, folder) {
    if (!file) return null;
    const ext = file.name.split('.').pop();
    const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { error } = await supabase.storage.from('receipts').upload(path, file);
    if (error) return null;
    const { data } = supabase.storage.from('receipts').getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!tycAccepted) {
      alert('Debes aceptar los Términos y Condiciones legales para continuar.');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    try {
      const authData = await signUp(email.trim(), password, {
        role: rol,
        full_name: nombre.trim(),
        phone: telefono.trim(),
      });

      const userId = authData.user?.id;

      if (rol === 'client' && userId) {
        await supabase.from('client_profiles').upsert([{
          id: userId,
          full_name: nombre.trim(),
          phone: telefono.trim(),
          terms_accepted: true,
        }]);
        alert('¡Cuenta de cliente creada con éxito!');
        navigate('/');

      } else if (rol === 'restaurant' && userId) {
        const { data: nuevoNegocio, error: negErr } = await supabase
          .from('businesses')
          .insert([{
            owner_id: userId,
            name: localNombre.trim() || `${nombre} Cocina`,
            category: localCategoria,
            phone: telefono.trim(),
            is_active: true,
          }])
          .select()
          .single();

        if (!negErr && nuevoNegocio) {
          const urlSanitario = await uploadRecaudo(permisoSanitario, 'verificaciones');
          await supabase.from('restaurant_verifications').insert([{
            business_id: nuevoNegocio.id,
            rif: localRif.trim() || 'J-00000000-0',
            sanitary_permit_url: urlSanitario,
            status: 'pending',
          }]);
        }

        alert('¡Restaurante registrado con éxito! Redirigiendo a tu panel de cocina.');
        navigate('/cocina');

      } else if (rol === 'delivery' && userId) {
        const urlCedula = await uploadRecaudo(driverCedula, 'choferes');
        const urlLicencia = await uploadRecaudo(driverLicencia, 'choferes');

        await supabase.from('driver_profiles').upsert([{
          id: userId,
          full_name: nombre.trim(),
          phone: telefono.trim(),
          vehicle_type: vehiculoTipo,
          vehicle_plate: vehiculoPlaca.trim() || 'S/P',
          id_doc_url: urlCedula,
          license_doc_url: urlLicencia,
          cash_debt: 0,
          is_online: true,
        }]);

        alert('¡Cuenta de repartidor creada con éxito! Redirigiendo a tu panel de entregas.');
        navigate('/delivery');
      }

    } catch (err) {
      setErrorMsg('Error al registrar usuario: ' + err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: '540px', marginTop: '40px', marginBottom: '80px' }}>
      
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <Link to="/portal" style={{ color: 'var(--gold)', textDecoration: 'none', fontSize: '0.85rem' }}>
          ← Ya tengo cuenta, ir a Iniciar Sesión
        </Link>
        <h1 style={{ fontSize: '1.8rem', margin: '8px 0 4px 0', color: '#fff' }}>Registro en Tropicalia</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
          Selecciona tu tipo de perfil para comenzar
        </p>
      </div>

      <div className="card">
        
        {/* SELECTOR DE ROL */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '20px' }}>
          <button
            type="button"
            onClick={() => setRol('client')}
            className={`btn-tab ${rol === 'client' ? 'activo' : ''}`}
            style={{ justifyContent: 'center' }}
          >
            👤 Cliente
          </button>
          <button
            type="button"
            onClick={() => setRol('restaurant')}
            className={`btn-tab ${rol === 'restaurant' ? 'activo' : ''}`}
            style={{ justifyContent: 'center' }}
          >
            👨‍🍳 Cocina
          </button>
          <button
            type="button"
            onClick={() => setRol('delivery')}
            className={`btn-tab ${rol === 'delivery' ? 'activo' : ''}`}
            style={{ justifyContent: 'center' }}
          >
            🛵 Repartidor
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          
          <label>Nombre y Apellido (o Representante):</label>
          <input
            type="text"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            required
            placeholder="Ej: Daniel Rodríguez"
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <div>
              <label>Correo Electrónico:</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="tu@correo.com"
              />
            </div>
            <div>
              <label>Teléfono (WhatsApp):</label>
              <input
                type="tel"
                value={telefono}
                onChange={e => setTelefono(e.target.value)}
                required
                placeholder="04121234567"
              />
            </div>
          </div>

          <label>Contraseña segura:</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={6}
            placeholder="Mínimo 6 caracteres"
          />

          {/* CAMPOS DE COCINA */}
          {rol === 'restaurant' && (
            <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '14px', margin: '14px 0' }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--gold)' }}>Datos del Restaurante</h4>
              <label>Nombre Comercial del Local:</label>
              <input
                type="text"
                value={localNombre}
                onChange={e => setLocalNombre(e.target.value)}
                required
                placeholder="Ej: Hamburguesas La Estación"
              />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div>
                  <label>Categoría Gastronómica:</label>
                  <select value={localCategoria} onChange={e => setLocalCategoria(e.target.value)}>
                    <option value="Comida Rápida">Comida Rápida</option>
                    <option value="Pizza y Pastas">Pizza y Pastas</option>
                    <option value="Sushi y Asiática">Sushi y Asiática</option>
                    <option value="Postres y Café">Postres y Café</option>
                    <option value="Bebidas y Licores">Bebidas y Licores</option>
                    <option value="Gourmet">Gourmet</option>
                  </select>
                </div>
                <div>
                  <label>RIF de la Empresa:</label>
                  <input
                    type="text"
                    value={localRif}
                    onChange={e => setLocalRif(e.target.value)}
                    placeholder="J-12345678-0"
                  />
                </div>
              </div>

              <label>Permiso Sanitario o Documento Fiscal (PDF o Foto):</label>
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={e => setPermisoSanitario(e.target.files[0] || null)}
                style={{ background: '#1c1c1c' }}
              />
            </div>
          )}

          {/* CAMPOS DE REPARTIDOR */}
          {rol === 'delivery' && (
            <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '14px', margin: '14px 0' }}>
              <h4 style={{ margin: '0 0 10px 0', color: '#34d399' }}>Datos de Repartidor Independiente</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div>
                  <label>Tipo de Vehículo:</label>
                  <select value={vehiculoTipo} onChange={e => setVehiculoTipo(e.target.value)}>
                    <option value="moto">🏍️ Moto</option>
                    <option value="bicicleta">🚲 Bicicleta</option>
                    <option value="auto">🚗 Automóvil</option>
                  </select>
                </div>
                <div>
                  <label>Número de Placa:</label>
                  <input
                    type="text"
                    value={vehiculoPlaca}
                    onChange={e => setVehiculoPlaca(e.target.value)}
                    placeholder="Ej: AB1C23D"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div>
                  <label>Foto Cédula de Identidad:</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => setDriverCedula(e.target.files[0] || null)}
                    style={{ background: '#1c1c1c' }}
                  />
                </div>
                <div>
                  <label>Foto Licencia de Conducir:</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => setDriverLicencia(e.target.files[0] || null)}
                    style={{ background: '#1c1c1c' }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* TÉRMINOS Y CONDICIONES LEGALES */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', margin: '16px 0' }}>
            <input
              type="checkbox"
              id="chk-tyc-box"
              checked={tycAccepted}
              onChange={e => setTycAccepted(e.target.checked)}
              style={{ width: 'auto', marginTop: '4px', cursor: 'pointer' }}
              required
            />
            <label htmlFor="chk-tyc-box" style={{ fontSize: '0.82rem', color: '#ccc', cursor: 'pointer' }}>
              Acepto los{' '}
              <Link to="/legal" target="_blank" style={{ color: 'var(--gold)', textDecoration: 'underline' }}>
                Términos y Condiciones Legales de Tropicalia
              </Link>
              {rol === 'client' && ' (Servicio de intermediación tecnológica y entrega).'}
              {rol === 'restaurant' && ' (Comisión del 10%, cortes diarios y responsabilidad sanitaria).'}
              {rol === 'delivery' && ' (Contrato mercantil autónomo y límite de deuda de $20).'}
            </label>
          </div>

          {errorMsg && (
            <div style={{
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid var(--red)',
              color: '#fca5a5',
              padding: '10px',
              borderRadius: '8px',
              fontSize: '0.85rem',
              marginBottom: '12px'
            }}>
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            className="btn-primario"
            style={{ width: '100%', padding: '12px' }}
            disabled={submitting}
          >
            {submitting ? 'Procesando registro...' : (
              rol === 'client' ? 'Crear Cuenta de Cliente' :
              rol === 'restaurant' ? 'Solicitar Registro de Restaurante' :
              'Registrarse como Repartidor'
            )}
          </button>

        </form>
      </div>

    </div>
  );
}

