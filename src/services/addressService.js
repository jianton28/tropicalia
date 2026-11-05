import { supabase } from '../lib/supabase.js';

const STORAGE_KEY = 'tropicalia_saved_addresses';

export const addressService = {
  /**
   * Obtiene la lista de direcciones. Retorna un Arreglo "Thenable" híbrido:
   * 1. Puede ser consumido síncronamente como Array clásico: const list = addressService.getAddresses();
   * 2. Puede ser consumido asíncronamente como Promesa: addressService.getAddresses(userId).then(addrs => ...)
   * Si se provee userId, el método .then() sincroniza con Supabase en segundo plano.
   */
  getAddresses(userId = null) {
    let list = [];
    try {
      const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (stored) {
        list = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Error leyendo direcciones locales:', e);
    }

    if (!Array.isArray(list) || list.length === 0) {
      const defaultAddr = (typeof localStorage !== 'undefined' && localStorage.getItem('tropicalia_delivery_address')) || 'Av. Las Delicias, Edif. Torre';
      list = [
        {
          id: 'addr_default',
          alias: 'Casa / Principal',
          esTercero: false,
          es_tercero: false,
          recipientName: '',
          recipient_name: '',
          recipientPhone: '',
          recipient_phone: '',
          address: defaultAddr,
          lat: 10.4950,
          lng: -66.8480,
          isDefault: true,
          is_default: true
        }
      ];
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      }
    } else {
      // Normalizar campos para compatibilidad camelCase y snake_case
      list = list.map(item => ({
        ...item,
        isDefault: Boolean(item.isDefault ?? item.is_default),
        is_default: Boolean(item.isDefault ?? item.is_default),
        recipientName: item.recipientName || item.recipient_name || '',
        recipient_name: item.recipientName || item.recipient_name || '',
        recipientPhone: item.recipientPhone || item.recipient_phone || '',
        recipient_phone: item.recipientPhone || item.recipient_phone || '',
        esTercero: Boolean(item.esTercero || item.es_tercero || item.recipientName || item.recipient_name),
        es_tercero: Boolean(item.esTercero || item.es_tercero || item.recipientName || item.recipient_name)
      }));
    }

    // Configurar protocolo Thenable (Promesa) en el arreglo para evitar errores "getAddresses(...).then is not a function"
    const self = this;
    Object.defineProperty(list, 'then', {
      value: function(onFulfilled, onRejected) {
        if (userId) {
          return self.syncWithSupabase(userId).then(onFulfilled, onRejected);
        }
        // Copia limpia del arreglo para evitar recursión infinita en la resolución de Promesas
        return Promise.resolve([...list]).then(onFulfilled, onRejected);
      },
      writable: true,
      configurable: true,
      enumerable: false
    });

    Object.defineProperty(list, 'catch', {
      value: function(onRejected) {
        if (userId) {
          return self.syncWithSupabase(userId).catch(onRejected);
        }
        return Promise.resolve([...list]).catch(onRejected);
      },
      writable: true,
      configurable: true,
      enumerable: false
    });

    return list;
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
      // Timeout de protección (3 segundos) para evitar bloqueos si la red falla o está offline
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Network timeout')), 3000)
      );

      const fetchPromise = supabase
        .from('user_addresses')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      const res = await Promise.race([fetchPromise, timeoutPromise]);
      const data = res?.data;
      const error = res?.error;

      if (!error && data && data.length > 0) {
        const mapped = data.map(d => ({
          id: d.id,
          alias: d.alias,
          esTercero: Boolean(d.recipient_name),
          es_tercero: Boolean(d.recipient_name),
          recipientName: d.recipient_name || '',
          recipient_name: d.recipient_name || '',
          recipientPhone: d.recipient_phone || '',
          recipient_phone: d.recipient_phone || '',
          address: d.address,
          lat: parseFloat(d.lat || 10.4950),
          lng: parseFloat(d.lng || -66.8480),
          isDefault: Boolean(d.is_default),
          is_default: Boolean(d.is_default)
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(mapped));
        return mapped;
      }
    } catch (e) {
      console.warn('Sincronizando direcciones con Supabase:', e.message || e);
    }
    return this.getAddresses();
  }
};

