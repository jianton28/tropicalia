const DEFAULT_BCV = 875.65;
const BCV_STORAGE_KEY = 'tropicalia_bcv';

export async function fetchTasaBCV() {
  try {
    const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
    if (res.ok) {
      const data = await res.json();
      if (data && data.promedio) {
        const rate = parseFloat(data.promedio);
        localStorage.setItem(BCV_STORAGE_KEY, rate.toString());
        return rate;
      }
    }
  } catch (error) {
    console.warn('No se pudo obtener la tasa en vivo de DolarAPI, usando respaldo:', error);
  }

  const cached = localStorage.getItem(BCV_STORAGE_KEY);
  return cached ? parseFloat(cached) : DEFAULT_BCV;
}

export function toBs(usdAmount, rate) {
  const r = rate || parseFloat(localStorage.getItem(BCV_STORAGE_KEY) || DEFAULT_BCV);
  return (usdAmount || 0) * r;
}

export function formatUsd(amount) {
  return `$${(Number(amount) || 0).toFixed(2)}`;
}

export function formatBs(amount) {
  return `Bs. ${(Number(amount) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

