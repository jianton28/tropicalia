import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/common/PasswordInput';
import SecurityVerification from '../components/common/SecurityVerification';
import { securityService } from '../services/securityService';
import { User, ChefHat, Bike } from '../components/common/Icons';

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
  const [botVerified, setBotVerified] = useState(false);

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

    if (!botVerified) {
      setErrorMsg('Por favor completa la verificación de seguridad anti-bot antes de registrarte.');
      return;
    }

    const cleanEmail = securityService.sanitizeInput(email);
    const cleanNombre = securityService.sanitizeInput(nombre);
    const cleanTelefono = securityService.sanitizeInput(telefono);

    if (!securityService.validateEmail(cleanEmail)) {
      setErrorMsg('Por favor ingresa un correo electrónico con formato válido.');
      return;
    }

    if (!securityService.validatePhoneVE(cleanTelefono)) {
      setErrorMsg('Por favor ingresa un número de teléfono válido (WhatsApp activo).');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    try {
      const authData = await signUp(cleanEmail, password, {
        role: rol,
        full_name: cleanNombre,
        phone: cleanTelefono,
      });

      const userId = authData.user?.id;

      if (rol === 'client' && userId) {
        await supabase.from('client_profiles').upsert([{
          id: userId,
          full_name: cleanNombre,
          phone: cleanTelefono,
          terms_accepted: true,
        }]);
        alert('¡Cuenta de cliente creada con éxito!');
        navigate('/');

      } else if (rol === 'restaurant' && userId) {
        const { data: nuevoNegocio, error: negErr } = await supabase
          .from('businesses')
          .insert([{
            owner_id: userId,
            name: securityService.sanitizeInput(localNombre) || `${cleanNombre} Cocina`,
            category: localCategoria,
            phone: cleanTelefono,
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
    <div style={{ position: 'relative', minHeight: '100vh', backgroundColor: '#ffffff', paddingBottom: '90px' }}>
      
      {/* HEADER PLANO OFICIAL FIGMA (Screenshot 225206) */}
      <header className="figma-header" style={{ marginBottom: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="figma-header-title" style={{ fontSize: '1.45rem' }}>
            Crear Cuenta
          </h1>
          <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: 'rgba(255, 255, 255, 0.85)' }}>
            Selecciona tu perfil en Tropicalia
          </p>
        </div>
        <Link
          to="/portal"
          style={{
            background: 'rgba(255,255,255,0.16)',
            color: '#ffffff',
            textDecoration: 'none',
            fontSize: '0.82rem',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            padding: '6px 12px',
            borderRadius: '999px'
          }}
        >
          ← Iniciar Sesión
        </Link>
      </header>

      <div style={{ padding: '0 20px' }}>
        {/* SELECTOR DE ROL CON ESTILO MANUAL DE MARCA */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' }}>
          <button
            type="button"
            onClick={() => setRol('client')}
            style={{
              padding: '9px 6px',
              borderRadius: '10px',
              border: rol === 'client' ? '2px solid var(--golden-orange)' : '1px solid rgba(130,19,58,0.35)',
              background: rol === 'client' ? 'var(--dark-amaranth)' : '#dedede',
              color: rol === 'client' ? '#ffffff' : 'var(--dark-amaranth)',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '0.82rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <User size={15} /> Cliente
          </button>
          <button
            type="button"
            onClick={() => setRol('restaurant')}
            style={{
              padding: '9px 6px',
              borderRadius: '10px',
              border: rol === 'restaurant' ? '2px solid var(--golden-orange)' : '1px solid rgba(130,19,58,0.35)',
              background: rol === 'restaurant' ? 'var(--dark-amaranth)' : '#dedede',
              color: rol === 'restaurant' ? '#ffffff' : 'var(--dark-amaranth)',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '0.82rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <ChefHat size={15} /> Cocina
          </button>
          <button
            type="button"
            onClick={() => setRol('delivery')}
            style={{
              padding: '9px 6px',
              borderRadius: '10px',
              border: rol === 'delivery' ? '2px solid var(--golden-orange)' : '1px solid rgba(130,19,58,0.35)',
              background: rol === 'delivery' ? 'var(--dark-amaranth)' : '#dedede',
              color: rol === 'delivery' ? '#ffffff' : 'var(--dark-amaranth)',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '0.82rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <Bike size={15} /> Repartidor
          </button>
        </div>

        <form onSubmit={handleSubmit} className="figma-form">
          
          <input
            type="text"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            required
            placeholder="Nombre y Apellido (o Representante):"
          />

          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            placeholder="Correo electrónico:"
          />

          <input
            type="tel"
            value={telefono}
            onChange={e => setTelefono(e.target.value)}
            required
            placeholder="Número de teléfono (WhatsApp):"
          />

          <PasswordInput
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={6}
            placeholder="Contraseña segura (mín. 6 caracteres):"
          />

          {/* CAMPOS DE COCINA */}
          {rol === 'restaurant' && (
            <div style={{ background: '#f8f5f6', border: '1px solid rgba(130,19,58,0.3)', borderRadius: '12px', padding: '14px', margin: '10px 0 14px 0' }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--dark-amaranth)', fontSize: '0.96rem' }}>Datos del Restaurante</h4>
              <input
                type="text"
                value={localNombre}
                onChange={e => setLocalNombre(e.target.value)}
                required
                placeholder="Nombre Comercial del Local:"
              />

              <select value={localCategoria} onChange={e => setLocalCategoria(e.target.value)}>
                <option value="Comida Rápida">Comida Rápida</option>
                <option value="Pizza y Pastas">Pizza y Pastas</option>
                <option value="Sushi y Asiática">Sushi y Asiática</option>
                <option value="Postres y Café">Postres y Café</option>
                <option value="Bebidas y Licores">Bebidas y Licores</option>
                <option value="Gourmet">Gourmet</option>
              </select>

              <input
                type="text"
                value={localRif}
                onChange={e => setLocalRif(e.target.value)}
                placeholder="RIF de la Empresa (Ej: J-12345678-0):"
              />

              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--dark-amaranth)', marginBottom: '4px' }}>
                Permiso Sanitario o Documento Fiscal (PDF o Foto):
              </label>
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={e => setPermisoSanitario(e.target.files[0] || null)}
                style={{ background: '#dedede', padding: '8px', borderRadius: '8px', width: '100%', boxSizing: 'border-box', fontSize: '0.8rem' }}
              />
            </div>
          )}

          {/* CAMPOS DE REPARTIDOR */}
          {rol === 'delivery' && (
            <div style={{ background: '#f8f5f6', border: '1px solid rgba(130,19,58,0.3)', borderRadius: '12px', padding: '14px', margin: '10px 0 14px 0' }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--dark-amaranth)', fontSize: '0.96rem' }}>Datos de Repartidor Independiente</h4>
              <select value={vehiculoTipo} onChange={e => setVehiculoTipo(e.target.value)}>
                <option value="moto">Moto</option>
                <option value="bicicleta">Bicicleta</option>
                <option value="auto">Automóvil</option>
              </select>

              <input
                type="text"
                value={vehiculoPlaca}
                onChange={e => setVehiculoPlaca(e.target.value)}
                placeholder="Número de Placa (Ej: AB1C23D):"
              />

              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--dark-amaranth)', marginBottom: '4px' }}>
                Foto Cédula de Identidad:
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={e => setDriverCedula(e.target.files[0] || null)}
                style={{ background: '#dedede', padding: '8px', borderRadius: '8px', width: '100%', boxSizing: 'border-box', fontSize: '0.8rem', marginBottom: '10px' }}
              />

              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--dark-amaranth)', marginBottom: '4px' }}>
                Foto Licencia de Conducir:
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={e => setDriverLicencia(e.target.files[0] || null)}
                style={{ background: '#dedede', padding: '8px', borderRadius: '8px', width: '100%', boxSizing: 'border-box', fontSize: '0.8rem' }}
              />
            </div>
          )}

          {/* TÉRMINOS Y CONDICIONES LEGALES */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', margin: '12px 0' }}>
            <input
              type="checkbox"
              id="chk-tyc-box"
              checked={tycAccepted}
              onChange={e => setTycAccepted(e.target.checked)}
              style={{ width: 'auto', marginTop: '4px', cursor: 'pointer', accentColor: 'var(--dark-amaranth)' }}
              required
            />
            <label htmlFor="chk-tyc-box" style={{ fontSize: '0.8rem', color: '#4b5563', cursor: 'pointer', lineHeight: 1.35 }}>
              Acepto los{' '}
              <Link to="/legal" target="_blank" style={{ color: 'var(--dark-amaranth)', textDecoration: 'underline', fontWeight: 700 }}>
                Términos y Condiciones Legales de Tropicalia
              </Link>
              {rol === 'client' && ' (Servicio de intermediación tecnológica y entrega).'}
              {rol === 'restaurant' && ' (Comisión del 10%, cortes diarios y responsabilidad sanitaria).'}
              {rol === 'delivery' && ' (Contrato mercantil autónomo y límite de deuda de $25).'}
            </label>
          </div>

          {errorMsg && (
            <div style={{
              background: '#fee2e2',
              border: '1px solid var(--flag-red)',
              color: '#991b1b',
              padding: '10px',
              borderRadius: '10px',
              fontSize: '0.84rem',
              fontWeight: 600,
              marginBottom: '12px'
            }}>
              {errorMsg}
            </div>
          )}

          {/* Verificación de Seguridad Anti-Bot Zero-Trust */}
          <SecurityVerification
            action="signup"
            onVerify={(_, valid) => setBotVerified(valid)}
          />

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '14px' }}>
            <button
              type="submit"
              className="btn-primario"
              style={{ minWidth: '190px', padding: '12px 28px', borderRadius: '10px' }}
              disabled={submitting}
            >
              {submitting ? 'Procesando...' : 'Aceptar'}
            </button>
          </div>

        </form>
      </div>

    </div>
  );
}

