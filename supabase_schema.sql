-- ==============================================================================
-- TROPICALIA CRB - ESQUEMA Y MIGRACIONES DE SUPABASE (POSTGRESQL)
-- ==============================================================================
-- Este script consolida y alinea todas las tablas, restricciones (CHECK constraints),
-- índices y suscripciones en tiempo real acordes a las nuevas funcionalidades:
-- 1. Flujo de Cancelación con Reversión de Stock e Inventario.
-- 2. Flujo de Retiro en Mostrador (Pickup) y Delivery a Domicilio.
-- 3. Notificaciones y Código Seguro de Entrega/Retiro.
-- ==============================================================================

-- 1. EXTENSIÓN UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLA: businesses (Restaurantes Aliados)
CREATE TABLE IF NOT EXISTS public.businesses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    phone TEXT,
    telegram_chat_id TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    logo_url TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    verification_status TEXT DEFAULT 'pending',
    owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    lat NUMERIC(10, 6) DEFAULT 10.4806,
    lng NUMERIC(10, 6) DEFAULT -66.9036,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABLA: products (Platos del Menú)
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    stock INTEGER DEFAULT 50, -- Stock directo opcional
    image_url TEXT,
    is_available BOOLEAN DEFAULT TRUE,
    category TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Si la tabla 'products' ya existía sin la columna 'stock':
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 50;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category TEXT;

-- 4. TABLA: inventory_items (Insumos de Cocina)
CREATE TABLE IF NOT EXISTS public.inventory_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    quantity NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    unit TEXT NOT NULL DEFAULT 'unidades',
    min_threshold NUMERIC(12, 2) DEFAULT 5.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. TABLA: product_recipes (Recetas de Platos -> Insumos)
CREATE TABLE IF NOT EXISTS public.product_recipes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    quantity_required NUMERIC(12, 2) NOT NULL DEFAULT 1.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TABLA: orders (Comandas, Delivery y Retiro Pickup)
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    delivery_type TEXT NOT NULL DEFAULT 'delivery', -- 'delivery' o 'pickup'
    delivery_address TEXT,
    map_url TEXT,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    subtotal_food NUMERIC(10, 2) DEFAULT 0.00,
    service_fee NUMERIC(10, 2) DEFAULT 0.00,
    delivery_fee NUMERIC(10, 2) DEFAULT 0.00,
    driver_tip NUMERIC(10, 2) DEFAULT 0.00,
    total NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    total_bs NUMERIC(14, 2) DEFAULT 0.00,
    exchange_rate_bcv NUMERIC(10, 2) DEFAULT 0.00,
    payment_method TEXT NOT NULL,
    payment_reference TEXT,
    payment_receipt_url TEXT,
    receipt_url TEXT,
    driver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    driver_eta_mins INTEGER,
    delivery_status TEXT DEFAULT 'available',
    delivery_code TEXT, -- Código seguro para entrega a domicilio o retiro en barra
    delivery_photo_url TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Actualizar restricciones CHECK en 'orders' para permitir todos los estados requeridos
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check 
  CHECK (status IN (
    'pending_payment_verification',
    'pending',
    'cooking',
    'ready',
    'on_the_way',
    'delivered',
    'cancelled'
  ));

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_delivery_type_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_delivery_type_check 
  CHECK (delivery_type IN ('delivery', 'pickup'));

-- 7. TABLA: kitchen_logs (Bitácora de Cocina: Venta Salón, Mermas y Reversiones)
CREATE TABLE IF NOT EXISTS public.kitchen_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    log_type TEXT NOT NULL,
    item_name TEXT NOT NULL,
    quantity NUMERIC(12, 2) DEFAULT 1.00,
    amount_usd NUMERIC(10, 2) DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Actualizar restricción CHECK en 'kitchen_logs' para soportar reversiones de pedidos cancelados
ALTER TABLE public.kitchen_logs DROP CONSTRAINT IF EXISTS kitchen_logs_log_type_check;
ALTER TABLE public.kitchen_logs ADD CONSTRAINT kitchen_logs_log_type_check 
  CHECK (log_type IN ('venta_salon', 'merma', 'reversion_cancelacion', 'devolucion', 'ajuste'));

-- 8. TABLA: driver_profiles (Perfiles de Repartidores)
CREATE TABLE IF NOT EXISTS public.driver_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone TEXT,
    vehicle_type TEXT DEFAULT 'moto',
    vehicle_plate TEXT,
    is_online BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. TABLA: delivery_wallets (Billetera y Techo de Deuda del Repartidor)
CREATE TABLE IF NOT EXISTS public.delivery_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID UNIQUE NOT NULL REFERENCES public.driver_profiles(id) ON DELETE CASCADE,
    prepaid_balance NUMERIC(10, 2) DEFAULT 0.00,
    cash_debt NUMERIC(10, 2) DEFAULT 0.00,
    debt_ceiling NUMERIC(10, 2) DEFAULT 20.00,
    is_blocked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. TABLA: client_profiles (Perfiles de Clientes)
CREATE TABLE IF NOT EXISTS public.client_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone TEXT,
    default_address TEXT,
    terms_accepted BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. TABLA: cash_closures (Cortes de Caja y Liquidación a Restaurantes)
CREATE TABLE IF NOT EXISTS public.cash_closures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    gross_amount NUMERIC(10, 2) DEFAULT 0.00,
    commission_amount NUMERIC(10, 2) DEFAULT 0.00,
    net_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    status TEXT DEFAULT 'pending_settlement', -- 'pending_settlement', 'settled'
    settlement_reference TEXT,
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. ÍNDICES DE RENDIMIENTO RECOMENDADOS
CREATE INDEX IF NOT EXISTS idx_orders_business_id ON public.orders(business_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_type ON public.orders(delivery_type);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_items_business_id ON public.inventory_items(business_id);
CREATE INDEX IF NOT EXISTS idx_product_recipes_product_id ON public.product_recipes(product_id);
CREATE INDEX IF NOT EXISTS idx_kitchen_logs_business_id ON public.kitchen_logs(business_id);

-- 13. HABILITACIÓN DE REALTIME EN TABLAS CLAVE
-- Agrega las tablas a la publicación de realtime de Supabase para que
-- Cocina, Repartidores y Clientes reciban cambios en vivo:
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_items;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cash_closures;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

