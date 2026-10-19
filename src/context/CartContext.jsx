import React, { createContext, useContext, useState, useEffect } from 'react';

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [cart, setCart] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('tropicalia_cart') || '[]');
    } catch {
      return [];
    }
  });

  const [businessId, setBusinessId] = useState(() => {
    return localStorage.getItem('tropicalia_business_id') || null;
  });

  const [businessName, setBusinessName] = useState(() => {
    return localStorage.getItem('tropicalia_business_name') || '';
  });

  useEffect(() => {
    localStorage.setItem('tropicalia_cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    if (businessId) {
      localStorage.setItem('tropicalia_business_id', businessId);
    } else {
      localStorage.removeItem('tropicalia_business_id');
    }
  }, [businessId]);

  useEffect(() => {
    if (businessName) {
      localStorage.setItem('tropicalia_business_name', businessName);
    } else {
      localStorage.removeItem('tropicalia_business_name');
    }
  }, [businessName]);

  const totalCount = cart.reduce((sum, item) => sum + (item.quantity || 1), 0);
  const subtotalUsd = cart.reduce((sum, item) => sum + ((parseFloat(item.price) || 0) * (item.quantity || 1)), 0);

  function addItem(item, targetBusinessId, targetBusinessName) {
    if (cart.length > 0 && businessId && businessId !== targetBusinessId) {
      const confirmChange = window.confirm(
        `Tu carrito tiene platos de "${businessName}". ¿Deseas vaciarlo para pedir en "${targetBusinessName}"?`
      );
      if (!confirmChange) return false;
      setCart([{ ...item, quantity: item.quantity || 1 }]);
      setBusinessId(targetBusinessId);
      setBusinessName(targetBusinessName);
      return true;
    }

    if (targetBusinessId) setBusinessId(targetBusinessId);
    if (targetBusinessName) setBusinessName(targetBusinessName);

    setCart(prev => {
      const index = prev.findIndex(i => i.id === item.id);
      if (index >= 0) {
        const updated = [...prev];
        updated[index] = {
          ...updated[index],
          quantity: updated[index].quantity + (item.quantity || 1)
        };
        return updated;
      } else {
        return [...prev, { ...item, quantity: item.quantity || 1 }];
      }
    });

    return true;
  }

  function changeQuantity(index, delta) {
    setCart(prev => {
      const updated = [...prev];
      if (updated[index]) {
        const newQ = updated[index].quantity + delta;
        if (newQ <= 0) {
          updated.splice(index, 1);
        } else {
          updated[index] = { ...updated[index], quantity: newQ };
        }
      }
      if (updated.length === 0) {
        setBusinessId(null);
        setBusinessName('');
      }
      return updated;
    });
  }

  function clearCart() {
    setCart([]);
    setBusinessId(null);
    setBusinessName('');
    localStorage.removeItem('tropicalia_cart');
    localStorage.removeItem('tropicalia_business_id');
    localStorage.removeItem('tropicalia_business_name');
  }

  return (
    <CartContext.Provider value={{
      cart,
      businessId,
      businessName,
      totalCount,
      subtotalUsd,
      addItem,
      changeQuantity,
      clearCart,
      setBusinessInfo: (id, name) => {
        setBusinessId(id);
        setBusinessName(name);
      }
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart debe ser usado dentro de CartProvider');
  }
  return context;
}

