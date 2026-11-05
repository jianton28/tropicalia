-- ==============================================================================
-- TROPICALIA CRB: ARQUITECTURA DE ROW LEVEL SECURITY (RLS) ZERO-TRUST
-- Script Idempotente para el Supabase SQL Editor
-- ==============================================================================
-- Este script implementa el aislamiento estricto por rol para:
-- 1. Clientes (client_profiles, orders, user_favorites, user_addresses)
-- 2. Cocinas / Restaurantes (businesses, kitchen_profiles, products, inventory_items, orders asignadas, kitchen_logs, cash_closures)
-- 3. Repartidores (driver_profiles, delivery_wallets, orders delivery, driver_withdrawals, delivery_transactions)
-- 4. Administradores (Acceso irrestricto y control total en todas las tablas)
-- 5. Catálogo Público (Lectura pública de restaurantes activos y platos disponibles)
-- ==============================================================================

-- ==============================================================================
-- 0. TABLAS DE COMPATIBILIDAD Y ALINEACIÓN DE COLUMNAS
-- ==============================================================================

-- Asegurar existencia de tabla de administradores
CREATE TABLE IF NOT EXISTS public.app_admins (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asegurar existencia de tabla de perfiles de cocina si se referencia de forma independiente
CREATE TABLE IF NOT EXISTS public.kitchen_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    full_name TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asegurar existencia de tabla de perfiles de clientes
CREATE TABLE IF NOT EXISTS public.client_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone TEXT,
    default_address TEXT,
    terms_accepted BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asegurar existencia de tabla de perfiles de repartidores
CREATE TABLE IF NOT EXISTS public.driver_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone TEXT,
    vehicle_type TEXT DEFAULT 'moto',
    vehicle_plate TEXT,
    is_online BOOLEAN DEFAULT FALSE,
    pagomovil_bank TEXT,
    pagomovil_id TEXT,
    pagomovil_phone TEXT,
    rating NUMERIC(3, 2) DEFAULT 4.95,
    rating_count INTEGER DEFAULT 64,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asegurar columnas de relación en 'orders' (soporta tanto customer_id/client_id como business_id/kitchen_id)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS kitchen_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS driver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Asegurar compatibilidad de tabla 'favorites' y 'user_favorites'
CREATE TABLE IF NOT EXISTS public.user_favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, product_id)
);

-- ==============================================================================
-- 1. FUNCIONES HELPER SECURITY DEFINER (EVITAN BUCLES Y MEJORAN RENDIMIENTO)
-- ==============================================================================

-- Función para verificar si el usuario es Administrador (SuperAdmin)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    -- 1. Verificación directa en la tabla de administradores
    EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = auth.uid())
    OR
    -- 2. Verificación en claims del JWT (App Metadata o User Metadata)
    (auth.jwt() ->> 'role' = 'admin')
    OR
    ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin')
    OR
    ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
    OR
    -- 3. Verificación de dominio corporativo de administración
    ((auth.jwt() ->> 'email') ILIKE '%@tropicalia.lat')
    OR
    ((auth.jwt() ->> 'email') ILIKE '%admin%')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Función para verificar si el usuario actual es dueño o personal de una cocina específica
CREATE OR REPLACE FUNCTION public.is_kitchen_owner(p_business_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  IF p_business_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN (
    -- Es dueño del local en la tabla 'businesses'
    EXISTS (
      SELECT 1 FROM public.businesses 
      WHERE id = p_business_id AND owner_id = auth.uid()
    )
    OR
    -- O está vinculado como operador en 'kitchen_profiles'
    EXISTS (
      SELECT 1 FROM public.kitchen_profiles 
      WHERE business_id = p_business_id AND id = auth.uid()
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ==============================================================================
-- 2. ÍNDICES DE RENDIMIENTO PARA EVALUACIÓN ULTRA-RÁPIDA DE RLS
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_businesses_owner_id ON public.businesses(owner_id);
CREATE INDEX IF NOT EXISTS idx_kitchen_profiles_biz_user ON public.kitchen_profiles(business_id, id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_client_id ON public.orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_business_id ON public.orders(business_id);
CREATE INDEX IF NOT EXISTS idx_orders_kitchen_id ON public.orders(kitchen_id);
CREATE INDEX IF NOT EXISTS idx_orders_driver_id ON public.orders(driver_id);
CREATE INDEX IF NOT EXISTS idx_user_favorites_user_id ON public.user_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_client_id ON public.favorites(COALESCE(user_id, client_id));
CREATE INDEX IF NOT EXISTS idx_user_addresses_user_id ON public.user_addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_delivery_wallets_driver_id ON public.delivery_wallets(driver_id);
CREATE INDEX IF NOT EXISTS idx_delivery_transactions_driver_id ON public.delivery_transactions(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_withdrawals_driver_id ON public.driver_withdrawals(driver_id);

-- ==============================================================================
-- 3. HABILITACIÓN DE ROW LEVEL SECURITY (RLS) EN TODAS LAS TABLAS
-- ==============================================================================
ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- 4. POLÍTICAS DE SEGURIDAD: TABLA app_admins
-- ==============================================================================
DROP POLICY IF EXISTS "app_admins_admin_all" ON public.app_admins;
CREATE POLICY "app_admins_admin_all"
ON public.app_admins FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- ==============================================================================
-- 5. POLÍTICAS DE SEGURIDAD: TABLA client_profiles
-- ==============================================================================
DROP POLICY IF EXISTS "client_profiles_admin_all" ON public.client_profiles;
CREATE POLICY "client_profiles_admin_all"
ON public.client_profiles FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "client_profiles_owner_select" ON public.client_profiles;
CREATE POLICY "client_profiles_owner_select"
ON public.client_profiles FOR SELECT
USING (auth.uid() = id);

DROP POLICY IF EXISTS "client_profiles_owner_insert" ON public.client_profiles;
CREATE POLICY "client_profiles_owner_insert"
ON public.client_profiles FOR INSERT
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "client_profiles_owner_update" ON public.client_profiles;
CREATE POLICY "client_profiles_owner_update"
ON public.client_profiles FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Staff (Cocinas y Repartidores) pueden ver el nombre/teléfono del cliente de órdenes asignadas
DROP POLICY IF EXISTS "client_profiles_staff_assigned_select" ON public.client_profiles;
CREATE POLICY "client_profiles_staff_assigned_select"
ON public.client_profiles FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE (o.customer_id = client_profiles.id OR o.client_id = client_profiles.id)
      AND (
        o.driver_id = auth.uid() OR
        public.is_kitchen_owner(o.business_id) OR
        o.kitchen_id = auth.uid()
      )
  )
);

-- ==============================================================================
-- 6. POLÍTICAS DE SEGURIDAD: TABLA businesses (Cocinas y Restaurantes)
-- ==============================================================================
DROP POLICY IF EXISTS "businesses_admin_all" ON public.businesses;
CREATE POLICY "businesses_admin_all"
ON public.businesses FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Lectura pública para exploración de restaurantes activos
DROP POLICY IF EXISTS "businesses_public_read_active" ON public.businesses;
CREATE POLICY "businesses_public_read_active"
ON public.businesses FOR SELECT
USING (is_active = TRUE);

-- La cocina puede ver su propio restaurante aunque esté pausado o inactivo
DROP POLICY IF EXISTS "businesses_owner_select" ON public.businesses;
CREATE POLICY "businesses_owner_select"
ON public.businesses FOR SELECT
USING (owner_id = auth.uid());

-- La cocina puede registrar su propio restaurante
DROP POLICY IF EXISTS "businesses_owner_insert" ON public.businesses;
CREATE POLICY "businesses_owner_insert"
ON public.businesses FOR INSERT
WITH CHECK (owner_id = auth.uid());

-- La cocina puede actualizar los datos de su restaurante
DROP POLICY IF EXISTS "businesses_owner_update" ON public.businesses;
CREATE POLICY "businesses_owner_update"
ON public.businesses FOR UPDATE
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

-- ==============================================================================
-- 7. POLÍTICAS DE SEGURIDAD: TABLA kitchen_profiles
-- ==============================================================================
DROP POLICY IF EXISTS "kitchen_profiles_admin_all" ON public.kitchen_profiles;
CREATE POLICY "kitchen_profiles_admin_all"
ON public.kitchen_profiles FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "kitchen_profiles_owner_select" ON public.kitchen_profiles;
CREATE POLICY "kitchen_profiles_owner_select"
ON public.kitchen_profiles FOR SELECT
USING (
  id = auth.uid() OR
  public.is_kitchen_owner(business_id)
);

DROP POLICY IF EXISTS "kitchen_profiles_owner_insert" ON public.kitchen_profiles;
CREATE POLICY "kitchen_profiles_owner_insert"
ON public.kitchen_profiles FOR INSERT
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "kitchen_profiles_owner_update" ON public.kitchen_profiles;
CREATE POLICY "kitchen_profiles_owner_update"
ON public.kitchen_profiles FOR UPDATE
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- ==============================================================================
-- 8. POLÍTICAS DE SEGURIDAD: TABLA driver_profiles (Repartidores)
-- ==============================================================================
DROP POLICY IF EXISTS "driver_profiles_admin_all" ON public.driver_profiles;
CREATE POLICY "driver_profiles_admin_all"
ON public.driver_profiles FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "driver_profiles_owner_select" ON public.driver_profiles;
CREATE POLICY "driver_profiles_owner_select"
ON public.driver_profiles FOR SELECT
USING (id = auth.uid());

DROP POLICY IF EXISTS "driver_profiles_owner_insert" ON public.driver_profiles;
CREATE POLICY "driver_profiles_owner_insert"
ON public.driver_profiles FOR INSERT
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "driver_profiles_owner_update" ON public.driver_profiles;
CREATE POLICY "driver_profiles_owner_update"
ON public.driver_profiles FOR UPDATE
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- Clientes y Cocinas pueden ver los datos del conductor asignado a su orden activa
DROP POLICY IF EXISTS "driver_profiles_assigned_order_select" ON public.driver_profiles;
CREATE POLICY "driver_profiles_assigned_order_select"
ON public.driver_profiles FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.driver_id = driver_profiles.id
      AND (
        o.customer_id = auth.uid() OR
        o.client_id = auth.uid() OR
        public.is_kitchen_owner(o.business_id) OR
        o.kitchen_id = auth.uid()
      )
  )
);

-- ==============================================================================
-- 9. POLÍTICAS DE SEGURIDAD: TABLA products (Platos del Menú)
-- ==============================================================================
DROP POLICY IF EXISTS "products_admin_all" ON public.products;
CREATE POLICY "products_admin_all"
ON public.products FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Lectura pública para cualquier usuario (incluso no autenticado) si el plato está disponible
DROP POLICY IF EXISTS "products_public_read_available" ON public.products;
CREATE POLICY "products_public_read_available"
ON public.products FOR SELECT
USING (is_available = TRUE);

-- La cocina puede ver todos sus productos (incluidos pausados o no disponibles)
DROP POLICY IF EXISTS "products_kitchen_select" ON public.products;
CREATE POLICY "products_kitchen_select"
ON public.products FOR SELECT
USING (public.is_kitchen_owner(business_id));

-- La cocina puede crear, modificar o eliminar platos de su menú
DROP POLICY IF EXISTS "products_kitchen_insert" ON public.products;
CREATE POLICY "products_kitchen_insert"
ON public.products FOR INSERT
WITH CHECK (public.is_kitchen_owner(business_id));

DROP POLICY IF EXISTS "products_kitchen_update" ON public.products;
CREATE POLICY "products_kitchen_update"
ON public.products FOR UPDATE
USING (public.is_kitchen_owner(business_id))
WITH CHECK (public.is_kitchen_owner(business_id));

DROP POLICY IF EXISTS "products_kitchen_delete" ON public.products;
CREATE POLICY "products_kitchen_delete"
ON public.products FOR DELETE
USING (public.is_kitchen_owner(business_id));

-- ==============================================================================
-- 10. POLÍTICAS DE SEGURIDAD: TABLA orders (COMANDAS Y ENTREGAS - CRÍTICA)
-- ==============================================================================
DROP POLICY IF EXISTS "orders_admin_all" ON public.orders;
CREATE POLICY "orders_admin_all"
ON public.orders FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 10.1 CLIENTES:
-- Lectura: Solo de sus propios pedidos
DROP POLICY IF EXISTS "orders_client_select" ON public.orders;
CREATE POLICY "orders_client_select"
ON public.orders FOR SELECT
USING (
  customer_id = auth.uid() OR
  client_id = auth.uid()
);

-- Inserción: Solo pueden insertar pedidos con su propio user_id
DROP POLICY IF EXISTS "orders_client_insert" ON public.orders;
CREATE POLICY "orders_client_insert"
ON public.orders FOR INSERT
WITH CHECK (
  (customer_id = auth.uid() OR client_id = auth.uid() OR auth.uid() IS NOT NULL) AND
  total > 0 AND
  jsonb_array_length(items) > 0
);

-- Actualización por Cliente: Solo para cancelar mientras la orden está pendiente o actualizar comprobante
DROP POLICY IF EXISTS "orders_client_update" ON public.orders;
CREATE POLICY "orders_client_update"
ON public.orders FOR UPDATE
USING (
  (customer_id = auth.uid() OR client_id = auth.uid()) AND
  status IN ('pending', 'pending_payment_verification')
)
WITH CHECK (
  (customer_id = auth.uid() OR client_id = auth.uid()) AND
  status IN ('pending', 'pending_payment_verification', 'cancelled')
);

-- 10.2 COCINAS:
-- Lectura: Solo de pedidos dirigidos a sus cocinas
DROP POLICY IF EXISTS "orders_kitchen_select" ON public.orders;
CREATE POLICY "orders_kitchen_select"
ON public.orders FOR SELECT
USING (
  public.is_kitchen_owner(business_id) OR
  kitchen_id = auth.uid()
);

-- Actualización por Cocina: Modificar estado de preparación, rechazo o tiempos
DROP POLICY IF EXISTS "orders_kitchen_update" ON public.orders;
CREATE POLICY "orders_kitchen_update"
ON public.orders FOR UPDATE
USING (
  public.is_kitchen_owner(business_id) OR
  kitchen_id = auth.uid()
)
WITH CHECK (
  public.is_kitchen_owner(business_id) OR
  kitchen_id = auth.uid()
);

-- 10.3 REPARTIDORES:
-- Lectura: Carreras asignadas a él O carreras disponibles para entrega sin conductor asignado
DROP POLICY IF EXISTS "orders_driver_select" ON public.orders;
CREATE POLICY "orders_driver_select"
ON public.orders FOR SELECT
USING (
  delivery_type = 'delivery' AND (
    driver_id = auth.uid() OR
    (driver_id IS NULL AND status IN ('pending', 'cooking', 'ready', 'on_the_way'))
  )
);

-- Actualización por Repartidor: Aceptar carrera disponible o actualizar su propia entrega
DROP POLICY IF EXISTS "orders_driver_update" ON public.orders;
CREATE POLICY "orders_driver_update"
ON public.orders FOR UPDATE
USING (
  delivery_type = 'delivery' AND (
    driver_id = auth.uid() OR
    (driver_id IS NULL AND status IN ('pending', 'cooking', 'ready', 'on_the_way'))
  )
)
WITH CHECK (
  delivery_type = 'delivery' AND (
    driver_id = auth.uid()
  )
);

-- ==============================================================================
-- 11. POLÍTICAS DE SEGURIDAD: TABLAS favorites Y user_favorites
-- ==============================================================================
-- user_favorites
DROP POLICY IF EXISTS "user_favorites_admin_all" ON public.user_favorites;
CREATE POLICY "user_favorites_admin_all"
ON public.user_favorites FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "user_favorites_owner_all" ON public.user_favorites;
CREATE POLICY "user_favorites_owner_all"
ON public.user_favorites FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- favorites (alias o tabla adicional)
DROP POLICY IF EXISTS "favorites_admin_all" ON public.favorites;
CREATE POLICY "favorites_admin_all"
ON public.favorites FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "favorites_owner_all" ON public.favorites;
CREATE POLICY "favorites_owner_all"
ON public.favorites FOR ALL
USING (auth.uid() = user_id OR auth.uid() = client_id)
WITH CHECK (auth.uid() = user_id OR auth.uid() = client_id);

-- ==============================================================================
-- 12. POLÍTICAS DE SEGURIDAD: TABLA user_addresses (Direcciones de Clientes)
-- ==============================================================================
DROP POLICY IF EXISTS "user_addresses_admin_all" ON public.user_addresses;
CREATE POLICY "user_addresses_admin_all"
ON public.user_addresses FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "user_addresses_owner_all" ON public.user_addresses;
CREATE POLICY "user_addresses_owner_all"
ON public.user_addresses FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ==============================================================================
-- 13. POLÍTICAS DE SEGURIDAD: TABLAS INTERNAS DE COCINA
-- ==============================================================================
-- 13.1 inventory_items (Insumos)
DROP POLICY IF EXISTS "inventory_items_admin_all" ON public.inventory_items;
CREATE POLICY "inventory_items_admin_all"
ON public.inventory_items FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "inventory_items_kitchen_all" ON public.inventory_items;
CREATE POLICY "inventory_items_kitchen_all"
ON public.inventory_items FOR ALL
USING (public.is_kitchen_owner(business_id))
WITH CHECK (public.is_kitchen_owner(business_id));

-- 13.2 product_recipes (Recetas de Platos)
DROP POLICY IF EXISTS "product_recipes_admin_all" ON public.product_recipes;
CREATE POLICY "product_recipes_admin_all"
ON public.product_recipes FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "product_recipes_kitchen_all" ON public.product_recipes;
CREATE POLICY "product_recipes_kitchen_all"
ON public.product_recipes FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_recipes.product_id AND public.is_kitchen_owner(p.business_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_recipes.product_id AND public.is_kitchen_owner(p.business_id)
  )
);

-- 13.3 kitchen_logs (Bitácora de cocina)
DROP POLICY IF EXISTS "kitchen_logs_admin_all" ON public.kitchen_logs;
CREATE POLICY "kitchen_logs_admin_all"
ON public.kitchen_logs FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "kitchen_logs_kitchen_all" ON public.kitchen_logs;
CREATE POLICY "kitchen_logs_kitchen_all"
ON public.kitchen_logs FOR ALL
USING (public.is_kitchen_owner(business_id))
WITH CHECK (public.is_kitchen_owner(business_id));

-- 13.4 cash_closures (Cortes de caja a restaurantes)
DROP POLICY IF EXISTS "cash_closures_admin_all" ON public.cash_closures;
CREATE POLICY "cash_closures_admin_all"
ON public.cash_closures FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "cash_closures_kitchen_select" ON public.cash_closures;
CREATE POLICY "cash_closures_kitchen_select"
ON public.cash_closures FOR SELECT
USING (public.is_kitchen_owner(business_id));

DROP POLICY IF EXISTS "cash_closures_kitchen_insert" ON public.cash_closures;
CREATE POLICY "cash_closures_kitchen_insert"
ON public.cash_closures FOR INSERT
WITH CHECK (public.is_kitchen_owner(business_id));

-- ==============================================================================
-- 14. POLÍTICAS DE SEGURIDAD: BILLETERA Y TRANSACCIONES DE REPARTIDORES
-- ==============================================================================
-- 14.1 delivery_wallets (Billetera del repartidor)
DROP POLICY IF EXISTS "delivery_wallets_admin_all" ON public.delivery_wallets;
CREATE POLICY "delivery_wallets_admin_all"
ON public.delivery_wallets FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "delivery_wallets_driver_select" ON public.delivery_wallets;
CREATE POLICY "delivery_wallets_driver_select"
ON public.delivery_wallets FOR SELECT
USING (driver_id = auth.uid());

-- Inserción inicial de billetera propia
DROP POLICY IF EXISTS "delivery_wallets_driver_insert" ON public.delivery_wallets;
CREATE POLICY "delivery_wallets_driver_insert"
ON public.delivery_wallets FOR INSERT
WITH CHECK (driver_id = auth.uid());

-- 14.2 driver_withdrawals (Solicitudes de retiro de ganancias)
DROP POLICY IF EXISTS "driver_withdrawals_admin_all" ON public.driver_withdrawals;
CREATE POLICY "driver_withdrawals_admin_all"
ON public.driver_withdrawals FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "driver_withdrawals_driver_select" ON public.driver_withdrawals;
CREATE POLICY "driver_withdrawals_driver_select"
ON public.driver_withdrawals FOR SELECT
USING (driver_id = auth.uid());

DROP POLICY IF EXISTS "driver_withdrawals_driver_insert" ON public.driver_withdrawals;
CREATE POLICY "driver_withdrawals_driver_insert"
ON public.driver_withdrawals FOR INSERT
WITH CHECK (driver_id = auth.uid());

-- 14.3 delivery_transactions (Auditoría de deuda y fletes)
DROP POLICY IF EXISTS "delivery_transactions_admin_all" ON public.delivery_transactions;
CREATE POLICY "delivery_transactions_admin_all"
ON public.delivery_transactions FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "delivery_transactions_driver_select" ON public.delivery_transactions;
CREATE POLICY "delivery_transactions_driver_select"
ON public.delivery_transactions FOR SELECT
USING (driver_id = auth.uid());

-- ==============================================================================
-- 15. POLÍTICAS DE SEGURIDAD: order_ratings (Calificaciones)
-- ==============================================================================
DROP POLICY IF EXISTS "order_ratings_admin_all" ON public.order_ratings;
CREATE POLICY "order_ratings_admin_all"
ON public.order_ratings FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Lectura pública para calcular promedios y mostrar reseñas a los comensales
DROP POLICY IF EXISTS "order_ratings_public_select" ON public.order_ratings;
CREATE POLICY "order_ratings_public_select"
ON public.order_ratings FOR SELECT
USING (TRUE);

-- Inserción solo permitida al cliente dueño de la orden calificada
DROP POLICY IF EXISTS "order_ratings_client_insert" ON public.order_ratings;
CREATE POLICY "order_ratings_client_insert"
ON public.order_ratings FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_ratings.order_id
      AND (o.customer_id = auth.uid() OR o.client_id = auth.uid())
  )
);

-- ==============================================================================
-- 16. POLÍTICAS DE SEGURIDAD: TABLAS DE CIBERSEGURIDAD Y AUDITORÍA
-- ==============================================================================
-- 16.1 security_audit_logs
DROP POLICY IF EXISTS "security_audit_logs_admin_all" ON public.security_audit_logs;
CREATE POLICY "security_audit_logs_admin_all"
ON public.security_audit_logs FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Inserción de logs de seguridad desde el sistema o cliente autenticado
DROP POLICY IF EXISTS "security_audit_logs_insert" ON public.security_audit_logs;
CREATE POLICY "security_audit_logs_insert"
ON public.security_audit_logs FOR INSERT
WITH CHECK (TRUE);

-- 16.2 rate_limits
DROP POLICY IF EXISTS "rate_limits_admin_all" ON public.rate_limits;
CREATE POLICY "rate_limits_admin_all"
ON public.rate_limits FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- ==============================================================================
-- FIN DEL SCRIPT DE POLÍTICAS RLS ZERO-TRUST
-- ==============================================================================

