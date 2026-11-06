-- ==============================================================================
-- TROPICALIA CRB: CORRECCIÓN DE CLAVES FORÁNEAS (FOREIGN KEYS) Y JOINS REST API
-- Script para ejecutar en el Supabase SQL Editor
-- ==============================================================================
-- Este script soluciona los errores HTTP 400 (PGRST200: Could not find relationship)
-- al realizar peticiones con joins en la API REST de Supabase:
-- 1. driver_profiles con delivery_wallets
-- 2. products con businesses
-- ==============================================================================

-- 1. CORRECCIÓN: delivery_wallets -> driver_profiles
-- PostgREST requiere que la clave foránea apunte explícitamente a public.driver_profiles(id)
-- para poder resolver: supabase.from('driver_profiles').select('*, delivery_wallets(*)')
DO $$
BEGIN
  -- Eliminar restricciones previas si apuntaban a auth.users u otro nombre
  ALTER TABLE public.delivery_wallets 
    DROP CONSTRAINT IF EXISTS delivery_wallets_driver_id_fkey;

  -- Crear clave foránea exacta hacia public.driver_profiles(id)
  ALTER TABLE public.delivery_wallets
    ADD CONSTRAINT delivery_wallets_driver_id_fkey
    FOREIGN KEY (driver_id) 
    REFERENCES public.driver_profiles(id) 
    ON DELETE CASCADE;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Tabla driver_profiles o delivery_wallets no encontrada';
END $$;

-- 2. CORRECCIÓN: products -> businesses
-- PostgREST requiere que business_id tenga la restricción hacia public.businesses(id)
-- para poder resolver: supabase.from('products').select('*, businesses(*)')
DO $$
BEGIN
  -- Eliminar restricción previa si existe con nombre ambiguo
  ALTER TABLE public.products 
    DROP CONSTRAINT IF EXISTS products_business_id_fkey;

  -- Crear clave foránea exacta hacia public.businesses(id)
  ALTER TABLE public.products
    ADD CONSTRAINT products_business_id_fkey
    FOREIGN KEY (business_id) 
    REFERENCES public.businesses(id) 
    ON DELETE CASCADE;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Tabla products o businesses no encontrada';
END $$;

-- 3. CLAVES FORÁNEAS COMPLEMENTARIAS PARA JOINS TRANSACCIONALES
-- delivery_transactions -> driver_profiles
DO $$
BEGIN
  ALTER TABLE public.delivery_transactions 
    DROP CONSTRAINT IF EXISTS delivery_transactions_driver_id_fkey;

  ALTER TABLE public.delivery_transactions
    ADD CONSTRAINT delivery_transactions_driver_id_fkey
    FOREIGN KEY (driver_id) 
    REFERENCES public.driver_profiles(id) 
    ON DELETE CASCADE;
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;

-- driver_withdrawals -> driver_profiles
DO $$
BEGIN
  ALTER TABLE public.driver_withdrawals 
    DROP CONSTRAINT IF EXISTS driver_withdrawals_driver_id_fkey;

  ALTER TABLE public.driver_withdrawals
    ADD CONSTRAINT driver_withdrawals_driver_id_fkey
    FOREIGN KEY (driver_id) 
    REFERENCES public.driver_profiles(id) 
    ON DELETE CASCADE;
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;

-- 4. ÍNDICES DE ALTO RENDIMIENTO PARA BÚSQUEDAS Y JOINS
CREATE INDEX IF NOT EXISTS idx_delivery_wallets_driver_id ON public.delivery_wallets(driver_id);
CREATE INDEX IF NOT EXISTS idx_products_business_id ON public.products(business_id);

-- 4.1 PREVENCIÓN DE CIERRES DE CAJA DUPLICADOS A NIVEL DE BASE DE DATOS
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_closure_per_business 
ON public.cash_closures (business_id) 
WHERE (status IN ('pending', 'pending_settlement'));

-- 5. RECARGA INMEDIATA DE LA CACHÉ DE ESQUEMA DE SUPABASE (POSTGREST)
-- Esto actualiza el catálogo interno de relaciones sin necesidad de reiniciar el servidor
NOTIFY pgrst, 'reload schema';

