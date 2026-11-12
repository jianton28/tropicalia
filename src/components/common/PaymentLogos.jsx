import React from 'react';
import kontigoImg from '../../assets/payment_logos/kontigo.png';
import paypalImg from '../../assets/payment_logos/paypal.png';
import binanceImg from '../../assets/payment_logos/binance.png';
import zinliImg from '../../assets/payment_logos/zinli.png';
import zelleImg from '../../assets/payment_logos/zelle.png';

/**
 * Logotipos Oficiales de Métodos de Pago para Tropicalia Checkout
 * Utiliza exactamente las imágenes oficiales proporcionadas por el usuario,
 * optimizadas y escaladas a 4x (alta resolución / 300 DPI) para pantallas retina,
 * preservando fielmente el diseño, colores y proporciones de cada marca.
 */

// 1. KONTIGO
export function KontigoLogo({ style = {}, className = '' }) {
  return (
    <img 
      src={kontigoImg} 
      alt="Kontigo" 
      style={{ 
        width: '100%', 
        height: '100%', 
        maxHeight: '70px',
        objectFit: 'contain', 
        borderRadius: '10px',
        ...style 
      }} 
      className={className} 
    />
  );
}

// 2. PAYPAL
export function PayPalLogo({ style = {}, className = '' }) {
  return (
    <img 
      src={paypalImg} 
      alt="PayPal" 
      style={{ 
        width: '100%', 
        height: '100%', 
        maxHeight: '52px',
        maxWidth: '88%',
        objectFit: 'contain', 
        ...style 
      }} 
      className={className} 
    />
  );
}

// 3. BINANCE
export function BinanceLogo({ style = {}, className = '' }) {
  return (
    <img 
      src={binanceImg} 
      alt="Binance" 
      style={{ 
        width: '100%', 
        height: '100%', 
        maxHeight: '70px',
        objectFit: 'contain', 
        borderRadius: '10px',
        ...style 
      }} 
      className={className} 
    />
  );
}

// 4. ZINLI
export function ZinliLogo({ style = {}, className = '' }) {
  return (
    <img 
      src={zinliImg} 
      alt="Zinli" 
      style={{ 
        width: '100%', 
        height: '100%', 
        maxHeight: '52px',
        maxWidth: '88%',
        objectFit: 'contain', 
        ...style 
      }} 
      className={className} 
    />
  );
}

// 5. ZELLE
export function ZelleLogo({ style = {}, className = '' }) {
  return (
    <img 
      src={zelleImg} 
      alt="Zelle" 
      style={{ 
        width: '100%', 
        height: '100%', 
        maxHeight: '70px',
        objectFit: 'contain', 
        borderRadius: '10px',
        ...style 
      }} 
      className={className} 
    />
  );
}

// 6. EFECTIVO - Gráfica vectorial oficial fajo de billetes
export function CashBanknotesLogo({ style = {}, className = '' }) {
  return (
    <svg 
      width="58" 
      height="40" 
      viewBox="0 0 64 42" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      style={{ maxHeight: '100%', maxWidth: '85%', ...style }}
      className={className}
      aria-label="Efectivo"
    >
      <rect x="6" y="10" width="52" height="28" rx="4" fill="#34d399" />
      <rect x="4" y="6" width="52" height="28" rx="4" fill="#4ade80" />
      <rect x="2" y="2" width="52" height="28" rx="4" fill="#6ee7b7" stroke="#10b981" strokeWidth="1.5" />
      <circle cx="28" cy="16" r="6" fill="#059669" />
      <circle cx="11" cy="16" r="2.5" fill="#059669" />
      <circle cx="45" cy="16" r="2.5" fill="#059669" />
    </svg>
  );
}
