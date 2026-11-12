import React from 'react';

/**
 * Logotipos oficiales de métodos de pago para Tropicalia Checkout
 * Diseñados según los manuales de identidad originales de:
 * PayPal, Kontigo, Zinli, Binance y Zelle.
 */

// 1. KONTIGO - Logo oficial: emblema circular con espiral/cerdito + tipografía redondeada
export function KontigoLogo({ style = {}, className = '' }) {
  return (
    <svg 
      viewBox="0 0 120 54" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      style={{ height: '46px', width: 'auto', maxHeight: '100%', maxWidth: '90%', ...style }}
      className={className}
      aria-label="Kontigo"
    >
      <g transform="translate(46, 2)">
        {/* Oreja izquierda */}
        <path d="M7 6 C5 3, 2 5, 4 8 C5 9.5, 7 8, 7 6 Z" fill="#ffffff" />
        {/* Oreja derecha */}
        <path d="M21 6 C23 3, 26 5, 24 8 C23 9.5, 21 8, 21 6 Z" fill="#ffffff" />
        {/* Contorno de cabeza */}
        <circle cx="14" cy="14" r="10.5" stroke="#ffffff" strokeWidth="2.5" fill="none" />
        {/* Espiral central / hocico estilizado 'e' */}
        <path 
          d="M10.5 15 C10.5 12.8, 12.5 10.8, 15 10.8 C17.5 10.8, 19.5 12.5, 19.5 14.5 C19.5 16.5, 17.5 17.5, 15 17.5 C12.5 17.5, 9.5 16, 9.5 13.5 C9.5 10.5, 12.5 8, 15.5 8" 
          stroke="#ffffff" 
          strokeWidth="2.2" 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          fill="none" 
        />
      </g>
      {/* Nombre oficial en tipografía geométrica redondeada */}
      <text 
        x="60" 
        y="45" 
        textAnchor="middle" 
        fill="#ffffff" 
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" 
        fontWeight="800" 
        fontSize="18.5" 
        letterSpacing="-0.3px"
      >
        kontigo
      </text>
    </svg>
  );
}

// 2. PAYPAL - Logotipo oficial: monograma PP en dos tonos de azul + wordmark en itálica negrita
export function PayPalLogo({ style = {}, className = '' }) {
  return (
    <svg 
      viewBox="0 0 135 38" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      style={{ height: '32px', width: 'auto', maxHeight: '100%', maxWidth: '88%', ...style }}
      className={className}
      aria-label="PayPal"
    >
      <g transform="translate(4, 2)">
        {/* P azul oscuro posterior */}
        <path 
          d="M7.8 28.5 L11.5 3.2 H23.8 C28.8 3.2 32.3 4.3 34 6.5 C35.7 8.7 35.8 11.6 34.4 15.3 C32.8 19.7 29.9 22.7 25.7 24.2 C23.4 25 20.7 25.3 17.6 25.3 H15.2 L13 28.5 H7.8 Z" 
          fill="#003087" 
        />
        {/* P celeste anterior */}
        <path 
          d="M12.8 32 L16.5 6.7 H28.8 C33.8 6.7 37.3 7.8 39 10 C40.7 12.2 40.8 15.1 39.4 18.8 C37.8 23.2 34.9 26.2 30.7 27.7 C28.4 28.5 25.7 28.8 22.6 28.8 H20.2 L17.7 32 H12.8 Z" 
          fill="#0079C1" 
        />
        {/* Zona de fusión */}
        <path 
          d="M22.6 25.3 C25.1 25.3 27.4 24.9 29.2 24.2 C30 23.6 30.7 22.9 31.3 22 C32.4 20 32.8 17.5 32.4 15.2 C32.1 13.2 31.1 11.5 29.6 10.3 C28.4 9.3 26.7 8.7 24.4 8.7 H17.4 L15.2 25.3 H22.6 Z" 
          fill="#00457C" 
          opacity="0.65" 
        />
      </g>
      <text 
        x="50" 
        y="26" 
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" 
        fontStyle="italic" 
        fontWeight="900" 
        fontSize="24" 
        letterSpacing="-0.6px"
      >
        <tspan fill="#003087">Pay</tspan>
        <tspan fill="#0079C1">Pal</tspan>
      </text>
    </svg>
  );
}

// 3. BINANCE - Logotipo oficial: emblema de rombos entrelazados en oro (#F3BA2F) + tipografía Binance
export function BinanceLogo({ style = {}, className = '' }) {
  return (
    <svg 
      viewBox="0 0 132 38" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      style={{ height: '30px', width: 'auto', maxHeight: '100%', maxWidth: '88%', ...style }}
      className={className}
      aria-label="Binance"
    >
      <g transform="translate(6, 5)">
        {/* Rombo central */}
        <polygon points="14,14 10,10 14,6 18,10" fill="#F3BA2F" />
        {/* Faceta superior */}
        <polygon points="14,0 18.5,4.5 15.5,7.5 14,6 12.5,7.5 9.5,4.5" fill="#F3BA2F" />
        {/* Faceta inferior */}
        <polygon points="14,28 18.5,23.5 15.5,20.5 14,22 12.5,20.5 9.5,23.5" fill="#F3BA2F" />
        {/* Faceta izquierda */}
        <polygon points="0,14 4.5,9.5 7.5,12.5 6,14 7.5,15.5 4.5,18.5" fill="#F3BA2F" />
        {/* Faceta derecha */}
        <polygon points="28,14 23.5,9.5 20.5,12.5 22,14 20.5,15.5 23.5,18.5" fill="#F3BA2F" />
      </g>
      <text 
        x="44" 
        y="25" 
        fill="#F3BA2F" 
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" 
        fontWeight="800" 
        fontSize="20.5" 
        letterSpacing="-0.3px"
      >
        Binance
      </text>
    </svg>
  );
}

// 4. ZINLI - Logotipo oficial: Z estilizada con corte transversal + tipografía morada (#59359a)
export function ZinliLogo({ style = {}, className = '' }) {
  return (
    <svg 
      viewBox="0 0 120 40" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      style={{ height: '34px', width: 'auto', maxHeight: '100%', maxWidth: '88%', ...style }}
      className={className}
      aria-label="Zinli"
    >
      <g transform="translate(6, 4)">
        {/* Z distintiva con barra diagonal */}
        <path d="M4 5 H28 L10 27 H30" stroke="#59359a" strokeWidth="5.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <line x1="12" y1="16" x2="22" y2="16" stroke="#59359a" strokeWidth="4.2" strokeLinecap="round" />
        
        {/* i */}
        <circle cx="41" cy="7" r="2.8" fill="#59359a" />
        <line x1="41" y1="13" x2="41" y2="27" stroke="#59359a" strokeWidth="4.4" strokeLinecap="round" />
        
        {/* n */}
        <path d="M52 13 V27 M52 18 C54 14 62 13.5 64 18 V27" stroke="#59359a" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        
        {/* l */}
        <line x1="76" y1="4" x2="76" y2="27" stroke="#59359a" strokeWidth="4.4" strokeLinecap="round" />
        
        {/* i */}
        <circle cx="87" cy="7" r="2.8" fill="#59359a" />
        <line x1="87" y1="13" x2="87" y2="27" stroke="#59359a" strokeWidth="4.4" strokeLinecap="round" />
      </g>
    </svg>
  );
}

// 5. ZELLE - Logotipo oficial: Z con línea vertical divisoria + texto Zelle en blanco + SM
export function ZelleLogo({ style = {}, className = '' }) {
  return (
    <svg 
      viewBox="0 0 115 38" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      style={{ height: '32px', width: 'auto', maxHeight: '100%', maxWidth: '88%', ...style }}
      className={className}
      aria-label="Zelle"
    >
      <g transform="translate(4, 3)">
        {/* Trazo vertical que corta la Z */}
        <line x1="17" y1="1" x2="17" y2="31" stroke="#ffffff" strokeWidth="4.2" strokeLinecap="round" />
        
        {/* Z blanca */}
        <path d="M5 8 H29 L7 24 H30" stroke="#ffffff" strokeWidth="4.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        
        {/* e */}
        <path d="M37 19 H50 C50 14 46 13 43.5 13 C39.5 13 37 16 37 19 C37 22.5 39.5 25 44 25 C47.5 25 49.5 23.5 50 22" 
          stroke="#ffffff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        
        {/* l */}
        <line x1="57" y1="4" x2="57" y2="25" stroke="#ffffff" strokeWidth="3.8" strokeLinecap="round" />
        
        {/* l */}
        <line x1="66" y1="4" x2="66" y2="25" stroke="#ffffff" strokeWidth="3.8" strokeLinecap="round" />
        
        {/* e */}
        <path d="M74 19 H87 C87 14 83 13 80.5 13 C76.5 13 74 16 74 19 C74 22.5 76.5 25 81 25 C84.5 25 86.5 23.5 87 22" 
          stroke="#ffffff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        
        {/* SM */}
        <text x="91" y="11" fill="#ffffff" fontFamily="-apple-system, BlinkMacSystemFont, sans-serif" fontSize="8" fontWeight="800">SM</text>
      </g>
    </svg>
  );
}

// 6. EFECTIVO - Gráfica oficial de fajo de billetes en verde
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

