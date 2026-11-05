import { supabase } from '../lib/supabase.js';

const STORAGE_KEY = 'tropicalia_saved_addresses';

export const addressService = {
  getAddresses() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Error leyendo direcciones locales:', e);
    }

    // Dirección base por defecto si no hay ninguna
    const defaultAddr = localStorage.getItem('tropicalia_delivery_address') || 'Av. Las Delicias, Edif. Torre';
    const initial = [
      {
        id: 'addr_default',
        alias: 'Casa / Principal',
        esTercero: false,
        recipientName: '',
        recipientPhone: '',
        address: defaultAddr,
        lat: 10.4950,
        lng: -66.8480,
        isDefault: true
      }
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  },

  getDefaultAddress() {
    const list = this.getAddresses();
    return list.find(a => a.isDefault) || list[0] || null;
  },

  async saveAddress(addressData, userId = null) {
    if (!addressData || !addressData.address) throw new Error('La dirección es obligatoria.');

    const list = this.getAddresses();
    const newId = addressData.id || `addr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    
    // Si se marca como predeterminada, desmarcar las otras
    if (addressData.isDefault) {
      list.forEach(a => { a.isDefault = false; });
    }

    const newRecord = {
      id: newId,
      alias: addressData.alias?.trim() || 'Mi Dirección',
      esTercero: Boolean(addressData.esTercero),
      recipientName: addressData.recipientName?.trim() || '',
      recipientPhone: addressData.recipientPhone?.trim() || '',
      address: addressData.address.trim(),
      lat: addressData.lat ? parseFloat(addressData.lat) : 10.4950,
      lng: addressData.lng ? parseFloat(addressData.lng) : -66.8480,
      isDefault: Boolean(addressData.isDefault || list.length === 0)
    };

    const existingIdx = list.findIndex(a => a.id === newId);
    if (existingIdx >= 0) {
      list[existingIdx] = newRecord;
    } else {
      list.push(newRecord);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    localStorage.setItem('tropicalia_delivery_address', newRecord.address);

    // Si hay usuario autenticado, guardar en Supabase
    if (userId) {
      try {
        await supabase.from('user_addresses').upsert([{
          id: newId.startsWith('addr_') ? undefined : newId,
          user_id: userId,
          alias: newRecord.alias,
          recipient_name: newRecord.recipientName || null,
          recipient_phone: newRecord.recipientPhone || null,
          address: newRecord.address,
          lat: newRecord.lat,
          lng: newRecord.lng,
          is_default: newRecord.isDefault
        }]);
      } catch (err) {
        console.warn('Persistencia de dirección en Supabase:', err.message);
      }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tropicalia:addresses_changed', {
        detail: { address: newRecord, allAddresses: list }
      }));
    }

    return newRecord;
  },

  async deleteAddress(addressId, userId = null) {
    let list = this.getAddresses();
    list = list.filter(a => a.id !== addressId);
    if (list.length > 0 && !list.some(a => a.isDefault)) {
      list[0].isDefault = true;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));

    if (userId && !addressId.startsWith('addr_default')) {
      try {
        await supabase.from('user_addresses').delete().eq('id', addressId);
      } catch (err) {
        console.warn('Eliminando dirección en Supabase:', err);
      }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tropicalia:addresses_changed', {
        detail: { allAddresses: list }
      }));
    }
    return list;
  },

  async setDefault(addressId, userId = null) {
    const list = this.getAddresses();
    list.forEach(a => {
      a.isDefault = a.id === addressId;
      if (a.isDefault) {
        localStorage.setItem('tropicalia_delivery_address', a.address);
      }
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));

    if (userId) {
      try {
        await supabase.from('user_addresses').update({ is_default: false }).eq('user_id', userId);
        await supabase.from('user_addresses').update({ is_default: true }).eq('id', addressId);
      } catch (e) {
        console.warn('Actualización de default en Supabase:', e);
      }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tropicalia:addresses_changed', {
        detail: { allAddresses: list }
      }));
    }
    return list;
  },

  async syncWithSupabase(userId) {
    if (!userId) return this.getAddresses();
    try {
      const { data, error } = await supabase
        .from('user_addresses')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (!error && data && data.length > 0) {
        const mapped = data.map(d => ({
          id: d.id,
          alias: d.alias,
          esTercero: Boolean(d.recipient_name),
          recipientName: d.recipient_name || '',
          recipientPhone: d.recipient_phone || '',
          address: d.address,
          lat: parseFloat(d.lat || 10.4950),
          lng: parseFloat(d.lng || -66.8480),
          isDefault: Boolean(d.is_default)
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(mapped));
        return mapped;
      }
    } catch (e) {
      console.warn('Sincronizando direcciones con Supabase:', e);
    }
    return this.getAddresses();
  }
};

