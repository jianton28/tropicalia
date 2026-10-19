import React, { useState } from 'react';
import { Link } from 'react-router-dom';

export default function Legal() {
  const [tab, setTab] = useState('clientes');

  return (
    <div className="container" style={{ maxWidth: '920px', marginTop: '40px', marginBottom: '80px', lineHeight: 1.65 }}>
      
      <header style={{ marginBottom: '25px' }}>
        <Link to="/" style={{ color: 'var(--gold)', textDecoration: 'none', fontSize: '0.85rem' }}>
          ← Volver a la Tienda
        </Link>
        <h1 style={{ color: '#fff', fontSize: '2rem', margin: '10px 0 4px 0' }}>
          Marco Legal y Condiciones del Servicio
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
          Plataforma Tecnológica Tropicalia • República Bolivariana de Venezuela
        </p>
      </header>

      {/* SELECTOR DE DOCUMENTOS */}
      <nav className="admin-nav" style={{ gap: '10px' }}>
        <button
          className={`btn-tab ${tab === 'clientes' ? 'activo' : ''}`}
          onClick={() => setTab('clientes')}
        >
          👤 Términos para Clientes
        </button>
        <button
          className={`btn-tab ${tab === 'cocinas' ? 'activo' : ''}`}
          onClick={() => setTab('cocinas')}
        >
          👨‍🍳 Acuerdo con Restaurantes
        </button>
        <button
          className={`btn-tab ${tab === 'delivery' ? 'activo' : ''}`}
          onClick={() => setTab('delivery')}
        >
          🛵 Contrato Mercantil Repartidores
        </button>
      </nav>

      {/* 1. TÉRMINOS PARA CLIENTES */}
      {tab === 'clientes' && (
        <article className="card" style={{ padding: '28px' }}>
          <h2 style={{ color: 'var(--gold)', borderBottom: '1px solid #333', paddingBottom: '10px', marginTop: 0 }}>
            Condiciones Generales de Uso para Consumidores
          </h2>
          
          <div style={{ background: '#201a11', borderLeft: '4px solid var(--gold)', padding: '10px 14px', margin: '15px 0', fontSize: '0.85rem', color: '#fde68a' }}>
            <strong>Naturaleza del Servicio:</strong> Tropicalia es una plataforma de software de intermediación tecnológica bajo el Código de Comercio de Venezuela. No prepara alimentos ni es propietaria de los restaurantes.
          </div>

          <h3>1. Objeto y Alcance</h3>
          <p style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>
            La plataforma facilita el contacto entre clientes finales, locales gastronómicos independientes y prestadores de servicio de delivery autónomos.
          </p>

          <h3>2. Moneda, Tasas y Pagos</h3>
          <p style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>
            Los precios base pueden expresarse en Dólares Estadounidenses (USD). Las cancelaciones en moneda de curso legal (Bolívares) se liquidan conforme a la tasa oficial publicada por el Banco Central de Venezuela (BCV) para la fecha de la transacción.
          </p>

          <h3>3. Garantía y Responsabilidad de Alimentos</h3>
          <p style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>
            La inocuidad, sazón, gramaje, temperatura y manipulación sanitaria de los alimentos es de entera y exclusiva responsabilidad del restaurante emisor.
          </p>
        </article>
      )}

      {/* 2. ACUERDO CON RESTAURANTES */}
      {tab === 'cocinas' && (
        <article className="card" style={{ padding: '28px' }}>
          <h2 style={{ color: 'var(--gold)', borderBottom: '1px solid #333', paddingBottom: '10px', marginTop: 0 }}>
            Acuerdo Comercial y Operativo para Locales Aliados
          </h2>

          <div style={{ background: '#201a11', borderLeft: '4px solid var(--gold)', padding: '10px 14px', margin: '15px 0', fontSize: '0.85rem', color: '#fde68a' }}>
            <strong>Cumplimiento Sanitario y Fiscal:</strong> Todo restaurante aliado debe poseer permiso sanitario vigente, certificados de manipulación de alimentos y RIF comercial emitido por el SENIAT.
          </div>

          <h3>1. Comisión de Plataforma y Cortes de Caja</h3>
          <p style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>
            Tropicalia retiene una comisión por intermediación tecnológica sobre el subtotal de comida. Los cortes de liquidación se realizan según el calendario acordado en la consola administrativa.
          </p>

          <h3>2. Empaque y Sellos Térmicos</h3>
          <p style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>
            El local se compromete a entregar cada comanda al repartidor debidamente cerrada con precintos o sellos de seguridad térmicos para garantizar la trazabilidad de la orden.
          </p>
        </article>
      )}

      {/* 3. CONTRATO MERCANTIL DE REPARTIDORES */}
      {tab === 'delivery' && (
        <article className="card" style={{ padding: '28px' }}>
          <h2 style={{ color: 'var(--gold)', borderBottom: '1px solid #333', paddingBottom: '10px', marginTop: 0 }}>
            Términos y Contrato Mercantil para Repartidores Independientes
          </h2>

          <div style={{ background: '#201a11', borderLeft: '4px solid var(--gold)', padding: '10px 14px', margin: '15px 0', fontSize: '0.85rem', color: '#fde68a' }}>
            <strong>Autonomía Mercantil:</strong> El prestador de delivery opera de forma independiente y autónoma, utilizando su propio vehículo, sin relación de subordinación laboral bajo la LOTTT.
          </div>

          <h3>1. Billetera y Tope de Deuda</h3>
          <p style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>
            El repartidor que reciba pagos en efectivo de clientes acumula una deuda por la comisión del servicio. Si dicha deuda supera el techo operativo ($20.00 USD), el sistema suspenderá la asignación de nuevas carreras hasta saldar el saldo pendiente.
          </p>

          <h3>2. Código Seguro de Entrega</h3>
          <p style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>
            Para validar el cierre de una carrera y cobrar el flete, el repartidor debe solicitar e ingresar el código de 4 dígitos proporcionado al cliente.
          </p>
        </article>
      )}

    </div>
  );
}

