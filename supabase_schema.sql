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
    category TEXT DEFAULT 'Comida',
    phone TEXT,
    telegram_chat_id TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    logo_url TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    verification_status TEXT DEFAULT 'pending',
    owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    lat NUMERIC(10, 6) DEFAULT 10.4806,
    lng NUMERIC(10, 6) DEFAULT -66.9036,
    balance NUMERIC(10, 2) DEFAULT 0.00,
    total_sales NUMERIC(10, 2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Comida';

-- 2.1 TABLA: restaurant_verifications (Expediente de Verificación Sanitaria y Fiscal)
CREATE TABLE IF NOT EXISTS public.restaurant_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    rif TEXT,
    sanitary_permit_url TEXT,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
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
    id_doc_url TEXT,
    license_doc_url TEXT,
    cash_debt NUMERIC(10, 2) DEFAULT 0.00,
    is_online BOOLEAN DEFAULT FALSE,
    pagomovil_bank TEXT,
    pagomovil_id TEXT,
    pagomovil_phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Si la tabla driver_profiles ya existía sin las columnas de Pago Móvil y recaudos:
ALTER TABLE public.driver_profiles ADD COLUMN IF NOT EXISTS id_doc_url TEXT;
ALTER TABLE public.driver_profiles ADD COLUMN IF NOT EXISTS license_doc_url TEXT;
ALTER TABLE public.driver_profiles ADD COLUMN IF NOT EXISTS cash_debt NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE public.driver_profiles ADD COLUMN IF NOT EXISTS pagomovil_bank TEXT;
ALTER TABLE public.driver_profiles ADD COLUMN IF NOT EXISTS pagomovil_id TEXT;
ALTER TABLE public.driver_profiles ADD COLUMN IF NOT EXISTS pagomovil_phone TEXT;

-- 9. TABLA: delivery_wallets (Billetera y Techo de Deuda del Repartidor)
CREATE TABLE IF NOT EXISTS public.delivery_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID UNIQUE NOT NULL REFERENCES public.driver_profiles(id) ON DELETE CASCADE,
    prepaid_balance NUMERIC(10, 2) DEFAULT 0.00,
    cash_debt NUMERIC(10, 2) DEFAULT 0.00,
    debt_ceiling NUMERIC(10, 2) DEFAULT 25.00,
    is_blocked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Si la tabla delivery_wallets ya existía:
ALTER TABLE public.delivery_wallets ALTER COLUMN debt_ceiling SET DEFAULT 25.00;

-- 9.1 TABLA: driver_withdrawals (Solicitudes de Retiro de Ganancias)
CREATE TABLE IF NOT EXISTS public.driver_withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID NOT NULL REFERENCES public.driver_profiles(id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) NOT NULL,
    bank_name TEXT NOT NULL,
    id_doc TEXT NOT NULL,
    phone TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'settled', 'rejected'
    settlement_reference TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9.2 TABLA: delivery_transactions (Auditoría de Movimientos y Deuda en Calle)
CREATE TABLE IF NOT EXISTS public.delivery_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID NOT NULL REFERENCES public.driver_profiles(id) ON DELETE CASCADE,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    amount NUMERIC(10, 2) NOT NULL,
    type TEXT NOT NULL, -- 'cash_debt', 'delivery_fee_credit', 'debt_payment', 'payout'
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Columna de balance y ventas en negocios para conciliación de caja general
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS balance NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS total_sales NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS rating NUMERIC(3, 2) DEFAULT 4.90;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 128;

-- Rating de repartidores
ALTER TABLE public.driver_profiles ADD COLUMN IF NOT EXISTS rating NUMERIC(3, 2) DEFAULT 4.95;
ALTER TABLE public.driver_profiles ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 64;

-- Marca de tiempo de entrega para cálculo de ventana de calificación (30 mins)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- 9.3 TABLA: order_ratings (Sistema de Calificaciones de Platos, Locales y Repartidores)
CREATE TABLE IF NOT EXISTS public.order_ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES public.driver_profiles(id) ON DELETE SET NULL,
    business_rating INTEGER NOT NULL CHECK (business_rating BETWEEN 1 AND 5),
    business_comment TEXT,
    driver_rating INTEGER CHECK (driver_rating BETWEEN 1 AND 5),
    driver_comment TEXT,
    food_rating INTEGER CHECK (food_rating BETWEEN 1 AND 5),
    food_tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. TABLA: client_profiles (Perfiles de Clientes)
CREATE TABLE IF NOT EXISTS public.client_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone TEXT,
    default_address TEXT,
    avatar_url TEXT,
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
    status TEXT DEFAULT 'pending_settlement', -- 'pending_settlement', 'pending', 'settled'
    settlement_reference TEXT,
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Restricción estricta de base de datos para prevenir cierres de caja duplicados por negocio
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_closure_per_business 
ON public.cash_closures (business_id) 
WHERE (status IN ('pending', 'pending_settlement'));

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
    ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_wallets;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ==============================================================================
-- 14. CONFIGURACIÓN FORMAL DE SUPABASE AUTH & PLANTILLAS DE CORREO
-- ==============================================================================
-- En el panel de Supabase: Project Settings -> Authentication -> URL Configuration:
-- Site URL: https://tropicalia-rho.vercel.app
-- Additional Redirect URLs:
--   https://tropicalia-rho.vercel.app/**
--   https://tropicalia-rho.vercel.app/portal
--   https://tropicalia-rho.vercel.app/tracking
--
-- Plantilla de Confirmación de Registro (Email Templates -> Confirm signup):
-- Asunto: ¡Bienvenido a Tropicalia CRB! Confirma tu cuenta
-- Cuerpo HTML:
-- <h2>¡Hola! Bienvenido a Tropicalia CRB 🌴</h2>
-- <p>Gracias por unirte a nuestra comunidad gastronómica.</p>
-- <p>Para confirmar tu correo y acceder a tu cuenta, haz clic en el siguiente enlace:</p>
-- <p><a href="{{ .SiteURL }}/portal?confirmation_token={{ .TokenHash }}" style="background:#82133a; color:#fff; padding:12px 24px; border-radius:999px; text-decoration:none; font-weight:bold; display:inline-block;">Confirmar mi Cuenta</a></p>
-- <p>Si el botón no funciona, copia y pega esta dirección en tu navegador:</p>
-- <p>{{ .ConfirmationURL }}</p>
-- <p><small>Línea directa de atención y soporte: 0414-1352503 (WhatsApp wa.me/584141352503)</small></p>

-- ==============================================================================
-- 15. DIRECCIONES MÚLTIPLES, ENVÍOS A TERCEROS Y PLATOS FAVORITOS
-- ==============================================================================

-- 15.1 TABLA: user_addresses (Direcciones Múltiples y Envíos a Terceros)
CREATE TABLE IF NOT EXISTS public.user_addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    alias TEXT NOT NULL, -- 'Casa', 'Oficina', 'Mamá', 'Envío a Tercero'
    recipient_name TEXT, -- Nombre de la persona que recibe (para envíos a terceros)
    recipient_phone TEXT, -- Teléfono de contacto del tercero
    address TEXT NOT NULL,
    lat NUMERIC(10, 7),
    lng NUMERIC(10, 7),
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15.2 TABLA: user_favorites (Platos Favoritos de Clientes)
CREATE TABLE IF NOT EXISTS public.user_favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, product_id)
);

-- 15.3 TABLA: app_admins (Aislamiento y Verificación Estricta de Administradores)
CREATE TABLE IF NOT EXISTS public.app_admins (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15.4 AISLAMIENTO ESTRICTO DE ROLES: ROW LEVEL SECURITY (RLS)
-- NOTA: Las políticas exhaustivas Zero-Trust para todos los roles (Clientes, Cocinas, Repartidores, Admins)
-- se encuentran completamente orquestadas en la Sección 17.5 y en el archivo dedicado 'supabase_rls_policies.sql'.
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

-- 15.5 PROTECCIÓN CONTRA ESCALAMIENTO DE ROL DESDE EL CLIENTE
-- Impide que cualquier usuario altere su rol en raw_user_meta_data desde el frontend:
CREATE OR REPLACE FUNCTION public.proteger_rol_inmutable()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.raw_user_meta_data->>'role' IS DISTINCT FROM NEW.raw_user_meta_data->>'role') THEN
    IF current_user NOT IN ('supabase_admin', 'service_role') THEN
      NEW.raw_user_meta_data = jsonb_set(
        NEW.raw_user_meta_data,
        '{role}',
        to_jsonb(COALESCE(OLD.raw_user_meta_data->>'role', 'client'))
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_proteger_rol_inmutable ON auth.users;
CREATE TRIGGER trigger_proteger_rol_inmutable
BEFORE UPDATE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.proteger_rol_inmutable();

-- ==============================================================================
-- 16. OPTIMIZACIÓN DEL BUSCADOR GLOBAL INTELIGENTE (POSTGRESQL & SUPABASE)
-- ==============================================================================

-- 16.1 Habilitación de extensión de trigramas para búsqueda difusa y de texto
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 16.2 Índices GIN de Trigramas para búsquedas ultra-rápidas en Platos
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON public.products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_description_trgm ON public.products USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_category_trgm ON public.products USING gin (category gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_available_biz ON public.products (is_available, business_id);

-- 16.3 Índices GIN de Trigramas para Restaurantes y Dark Kitchens
CREATE INDEX IF NOT EXISTS idx_businesses_name_trgm ON public.businesses USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_businesses_category_trgm ON public.businesses USING gin (category gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_businesses_active_id ON public.businesses (is_active, id);

-- 16.4 Función RPC de Búsqueda Global Semántica y Cruzada
-- Permite consultar desde Supabase platos y restaurantes con puntuación de similitud
CREATE OR REPLACE FUNCTION public.buscar_tropicalia_global(termino TEXT)
RETURNS TABLE (
    tipo TEXT,
    id UUID,
    nombre TEXT,
    categoria TEXT,
    descripcion TEXT,
    precio NUMERIC,
    imagen_url TEXT,
    business_id UUID,
    business_name TEXT,
    similitud REAL
) AS $$
BEGIN
    RETURN QUERY
    -- 1. Platos coincidentes
    SELECT 
        'plato'::TEXT AS tipo,
        p.id,
        p.name AS nombre,
        COALESCE(p.category, 'General') AS categoria,
        COALESCE(p.description, '') AS descripcion,
        p.price AS precio,
        COALESCE(p.image_url, '') AS imagen_url,
        p.business_id,
        b.name AS business_name,
        GREATEST(
            similarity(p.name, termino),
            similarity(COALESCE(p.category, ''), termino) * 0.8,
            similarity(COALESCE(p.description, ''), termino) * 0.5
        ) AS similitud
    FROM public.products p
    JOIN public.businesses b ON b.id = p.business_id
    WHERE p.is_available = TRUE 
      AND b.is_active = TRUE
      AND (
          p.name ILIKE '%' || termino || '%'
          OR COALESCE(p.description, '') ILIKE '%' || termino || '%'
          OR COALESCE(p.category, '') ILIKE '%' || termino || '%'
          OR p.name % termino
      )

    UNION ALL

    -- 2. Restaurantes coincidentes
    SELECT 
        'restaurante'::TEXT AS tipo,
        b.id,
        b.name AS nombre,
        COALESCE(b.category, 'Cocina') AS categoria,
        ''::TEXT AS descripcion,
        0.00::NUMERIC AS precio,
        COALESCE(b.logo_url, '') AS imagen_url,
        b.id AS business_id,
        b.name AS business_name,
        GREATEST(
            similarity(b.name, termino),
            similarity(COALESCE(b.category, ''), termino) * 0.8
        ) AS similitud
    FROM public.businesses b
    WHERE b.is_active = TRUE
      AND (
          b.name ILIKE '%' || termino || '%'
          OR COALESCE(b.category, '') ILIKE '%' || termino || '%'
          OR b.name % termino
      )
    ORDER BY similitud DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- ==============================================================================
-- 17. BLINDAJE ZERO-TRUST: IDEMPOTENCIA, ANTI-BOT, RATE LIMITING Y RLS ESTRICTO
-- ==============================================================================

-- 17.1 Columnas de Seguridad e Idempotencia en Orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS client_ip TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS bot_verified BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_orders_idempotency_key ON public.orders(idempotency_key);

-- 17.2 Tabla de Auditoría de Ciberseguridad (Security Audit Logs)
CREATE TABLE IF NOT EXISTS public.security_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type TEXT NOT NULL, -- 'LOGIN_BRUTE_FORCE_BLOCKED', 'ORDER_IDEMPOTENT_HIT', 'RATE_LIMIT_EXCEEDED', 'FINANCIAL_SETTLEMENT'
    severity TEXT NOT NULL DEFAULT 'info', -- 'info', 'warning', 'critical'
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ip_address TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_audit_event_type ON public.security_audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_sec_audit_created_at ON public.security_audit_logs(created_at DESC);

-- 17.3 Tabla de Control de Frecuencia y Restricción de Tasa (Rate Limiting)
CREATE TABLE IF NOT EXISTS public.rate_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT UNIQUE NOT NULL, -- ej: 'order_phone_04141234567' o 'login_user@email.com'
    attempts INTEGER NOT NULL DEFAULT 1,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON public.rate_limits(key);

-- 17.4 Función de Verificación y Control de Tasa (Rate Limiting Sliding Window)
CREATE OR REPLACE FUNCTION public.verificar_rate_limit(
    p_key TEXT,
    p_max_attempts INT,
    p_window_seconds INT,
    p_lockout_seconds INT
) RETURNS BOOLEAN AS $$
DECLARE
    v_record RECORD;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    SELECT * INTO v_record FROM public.rate_limits WHERE key = p_key;

    IF v_record IS NULL THEN
        INSERT INTO public.rate_limits (key, attempts, window_start)
        VALUES (p_key, 1, v_now);
        RETURN TRUE;
    END IF;

    -- Verificar si está en período de bloqueo
    IF v_record.locked_until IS NOT NULL AND v_now < v_record.locked_until THEN
        RETURN FALSE;
    END IF;

    -- Si la ventana ya expiró, reiniciar contador
    IF v_now > (v_record.window_start + (p_window_seconds || ' seconds')::INTERVAL) THEN
        UPDATE public.rate_limits 
        SET attempts = 1, window_start = v_now, locked_until = NULL
        WHERE key = p_key;
        RETURN TRUE;
    END IF;

    -- Si sigue en la ventana activa:
    IF v_record.attempts >= p_max_attempts THEN
        UPDATE public.rate_limits 
        SET locked_until = v_now + (p_lockout_seconds || ' seconds')::INTERVAL
        WHERE key = p_key;
        RETURN FALSE;
    ELSE
        UPDATE public.rate_limits 
        SET attempts = attempts + 1
        WHERE key = p_key;
        RETURN TRUE;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 17.5 ENDURECIMIENTO DE POLÍTICAS RLS (ZERO-TRUST) EN TABLAS CRÍTICAS
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Products: Catálogo visible solo si está disponible; edición exclusiva del dueño
DROP POLICY IF EXISTS "ZeroTrust: Productos visibles publicos" ON public.products;
CREATE POLICY "ZeroTrust: Productos visibles publicos"
ON public.products FOR SELECT
USING (is_available = TRUE OR auth.role() = 'authenticated');

DROP POLICY IF EXISTS "ZeroTrust: Cocina gestiona productos propios" ON public.products;
CREATE POLICY "ZeroTrust: Cocina gestiona productos propios"
ON public.products FOR ALL
USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = auth.uid())
)
WITH CHECK (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = auth.uid())
);

-- RLS Businesses: Lectura pública de locales activos; modificación exclusiva de dueño
DROP POLICY IF EXISTS "ZeroTrust: Negocios visibles activos" ON public.businesses;
CREATE POLICY "ZeroTrust: Negocios visibles activos"
ON public.businesses FOR SELECT
USING (is_active = TRUE OR owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "ZeroTrust: Dueño actualiza negocio" ON public.businesses;
CREATE POLICY "ZeroTrust: Dueño actualiza negocio"
ON public.businesses FOR UPDATE
USING (owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = auth.uid()));

-- RLS Orders: Inserción protegida por esquema de validez y propiedad de usuario
DROP POLICY IF EXISTS "ZeroTrust: Insercion de pedidos validos" ON public.orders;
CREATE POLICY "ZeroTrust: Insercion de pedidos validos"
ON public.orders FOR INSERT
WITH CHECK (
    auth.uid() IS NOT NULL AND
    (customer_id = auth.uid() OR client_id = auth.uid()) AND
    total > 0 AND 
    jsonb_array_length(items) > 0 AND
    customer_phone IS NOT NULL AND
    customer_phone <> ''
);

DROP POLICY IF EXISTS "ZeroTrust: Clientes leen sus pedidos" ON public.orders;
CREATE POLICY "ZeroTrust: Clientes leen sus pedidos"
ON public.orders FOR SELECT
USING (
    customer_id = auth.uid() OR
    client_id = auth.uid() OR
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()) OR
    business_id IN (SELECT business_id FROM public.kitchen_profiles WHERE id = auth.uid()) OR
    (
      delivery_type = 'delivery' AND
      EXISTS (SELECT 1 FROM public.driver_profiles WHERE id = auth.uid()) AND
      (driver_id = auth.uid() OR (driver_id IS NULL AND status IN ('pending', 'cooking', 'ready', 'on_the_way')))
    ) OR
    EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = auth.uid())
);

-- RLS Security Logs: Solo lectura para administradores; inserción del sistema
DROP POLICY IF EXISTS "ZeroTrust: Solo admins leen logs de seguridad" ON public.security_audit_logs;
CREATE POLICY "ZeroTrust: Solo admins leen logs de seguridad"
ON public.security_audit_logs FOR SELECT
USING (EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "ZeroTrust: Sistema inserta logs de seguridad" ON public.security_audit_logs;
CREATE POLICY "ZeroTrust: Sistema inserta logs de seguridad"
ON public.security_audit_logs FOR INSERT
WITH CHECK (TRUE);

-- 17.6 FUNCIÓN RPC FINANCIERA SEGURA: CREACIÓN DE PEDIDO CON IDEMPOTENCIA Y RATE LIMITING
CREATE OR REPLACE FUNCTION public.crear_pedido_seguro(
    p_order_payload JSONB,
    p_idempotency_key TEXT
) RETURNS JSONB AS $$
DECLARE
    v_existing_order RECORD;
    v_new_order_id UUID;
    v_total NUMERIC;
    v_customer_phone TEXT;
    v_rate_limit_key TEXT;
    v_allowed BOOLEAN;
    v_result JSONB;
BEGIN
    -- 1. Control de Idempotencia: Si la clave ya existe, devolver la orden sin duplicar
    IF p_idempotency_key IS NOT NULL AND p_idempotency_key <> '' THEN
        SELECT id, status, total, customer_name INTO v_existing_order 
        FROM public.orders 
        WHERE idempotency_key = p_idempotency_key;

        IF v_existing_order.id IS NOT NULL THEN
            INSERT INTO public.security_audit_logs (event_type, severity, details)
            VALUES ('ORDER_IDEMPOTENT_HIT', 'info', jsonb_build_object(
                'order_id', v_existing_order.id,
                'idempotency_key', p_idempotency_key
            ));

            SELECT to_jsonb(o.*) INTO v_result FROM public.orders o WHERE o.id = v_existing_order.id;
            RETURN v_result;
        END IF;
    END IF;

    -- 2. Validación de Esquema
    v_total := COALESCE((p_order_payload->>'total')::NUMERIC, 0);
    v_customer_phone := p_order_payload->>'customer_phone';

    IF v_total <= 0 THEN
        RAISE EXCEPTION 'INVALID_ORDER_TOTAL: El total de la orden debe ser superior a 0.';
    END IF;

    IF v_customer_phone IS NULL OR length(trim(v_customer_phone)) < 7 THEN
        RAISE EXCEPTION 'INVALID_PHONE: El teléfono de contacto es obligatorio.';
    END IF;

    IF jsonb_array_length(COALESCE(p_order_payload->'items', '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'EMPTY_CART: El pedido debe contener al menos un plato.';
    END IF;

    IF COALESCE((p_order_payload->>'bot_verified')::BOOLEAN, FALSE) IS NOT TRUE THEN
        RAISE EXCEPTION 'BOT_VERIFICATION_REQUIRED: Debes completar la verificación de seguridad anti-bot.';
    END IF;

    -- 3. Restricción de Tasa (Rate Limiting de Pedidos): Máximo 1 pedido cada 20 segundos por teléfono
    v_rate_limit_key := 'order_rate_' || trim(v_customer_phone);
    v_allowed := public.verificar_rate_limit(v_rate_limit_key, 2, 30, 60);

    IF NOT v_allowed THEN
        INSERT INTO public.security_audit_logs (event_type, severity, details)
        VALUES ('ORDER_FLOOD_BLOCKED', 'warning', jsonb_build_object(
            'phone', v_customer_phone,
            'idempotency_key', p_idempotency_key
        ));
        RAISE EXCEPTION 'RATE_LIMIT_EXCEEDED: Por favor espera unos momentos antes de enviar otro pedido.';
    END IF;

    -- 4. Inserción atómica del pedido
    INSERT INTO public.orders (
        business_id,
        customer_id,
        customer_name,
        customer_phone,
        delivery_type,
        delivery_address,
        map_url,
        notes,
        payment_method,
        payment_reference,
        payment_receipt_url,
        items,
        subtotal_food,
        delivery_fee,
        driver_tip,
        total,
        total_bs,
        status,
        idempotency_key,
        bot_verified
    ) VALUES (
        (p_order_payload->>'business_id')::UUID,
        auth.uid(),
        p_order_payload->>'customer_name',
        v_customer_phone,
        COALESCE(p_order_payload->>'delivery_type', 'delivery'),
        p_order_payload->>'delivery_address',
        p_order_payload->>'map_url',
        p_order_payload->>'notes',
        p_order_payload->>'payment_method',
        p_order_payload->>'payment_reference',
        p_order_payload->>'payment_receipt_url',
        p_order_payload->'items',
        COALESCE((p_order_payload->>'subtotal_food')::NUMERIC, 0),
        COALESCE((p_order_payload->>'delivery_fee')::NUMERIC, 0),
        COALESCE((p_order_payload->>'driver_tip')::NUMERIC, 0),
        v_total,
        COALESCE((p_order_payload->>'total_bs')::NUMERIC, 0),
        COALESCE(p_order_payload->>'status', 'pending'),
        p_idempotency_key,
        COALESCE((p_order_payload->>'bot_verified')::BOOLEAN, TRUE)
    ) RETURNING id INTO v_new_order_id;

    -- 5. Registro de auditoría
    INSERT INTO public.security_audit_logs (event_type, severity, details)
    VALUES ('ORDER_CREATED_SECURE', 'info', jsonb_build_object(
        'order_id', v_new_order_id,
        'total', v_total,
        'idempotency_key', p_idempotency_key
    ));

    SELECT to_jsonb(o.*) INTO v_result FROM public.orders o WHERE o.id = v_new_order_id;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 17.7 FUNCIÓN RPC FINANCIERA SEGURA: LIQUIDACIÓN ATÓMICA DE BALANCE DE ENTREGAS
-- Ejecuta con SECURITY DEFINER para que el cliente no pueda manipular saldos o deudas
CREATE OR REPLACE FUNCTION public.procesar_balance_completado_seguro(
    p_order_id UUID,
    p_driver_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_order RECORD;
    v_wallet RECORD;
    v_es_efectivo BOOLEAN;
    v_monto_total NUMERIC;
    v_flete_ganado NUMERIC;
    v_subtotal_food NUMERIC;
    v_nueva_deuda NUMERIC;
    v_nuevo_saldo NUMERIC;
    v_is_blocked BOOLEAN;
    v_techo_deuda NUMERIC := 25.00;
BEGIN
    -- 0. Autorización Zero-Trust: solo el propio repartidor asignado o Admin
    IF auth.uid() IS DISTINCT FROM p_driver_id AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED: No autorizado para liquidar la billetera de otro repartidor.';
    END IF;

    -- 1. Obtener orden
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF v_order IS NULL THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: Orden no encontrada.';
    END IF;

    IF v_order.driver_id IS NOT NULL AND v_order.driver_id IS DISTINCT FROM p_driver_id AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'DRIVER_MISMATCH: La orden está asignada a otro repartidor.';
    END IF;

    -- 2. Asegurar existencia de billetera
    SELECT * INTO v_wallet FROM public.delivery_wallets WHERE driver_id = p_driver_id;
    IF v_wallet IS NULL THEN
        INSERT INTO public.delivery_wallets (driver_id, prepaid_balance, cash_debt, debt_ceiling, is_blocked)
        VALUES (p_driver_id, 0.00, 0.00, v_techo_deuda, FALSE)
        RETURNING * INTO v_wallet;
    END IF;

    v_es_efectivo := v_order.payment_method IN ('efectivo', 'efectivo_bs');
    v_monto_total := COALESCE(v_order.total, 0);
    v_flete_ganado := COALESCE(v_order.delivery_fee, 0) + COALESCE(v_order.driver_tip, 0);
    v_subtotal_food := COALESCE(v_order.subtotal_food, GREATEST(0, v_monto_total - v_flete_ganado));

    v_nueva_deuda := COALESCE(v_wallet.cash_debt, 0);
    v_nuevo_saldo := COALESCE(v_wallet.prepaid_balance, 0);
    v_is_blocked := COALESCE(v_wallet.is_blocked, FALSE);

    -- 3. Transacción atómica según método de pago
    IF v_es_efectivo THEN
        -- DESCUENTO AUTOMÁTICO DE FLETE GANADO EN EFECTIVO:
        -- El repartidor retiene en mano su ganancia de flete ($1.75). La deuda que rinde a caja
        -- aumenta únicamente por el neto de la comida ($7.75 - $1.75 = $6.00), evitando doble cobro.
        v_nueva_deuda := ROUND(v_nueva_deuda + GREATEST(0, v_monto_total - v_flete_ganado), 2);
        -- Bloquear si supera o iguala el techo de $25
        v_is_blocked := v_nueva_deuda >= v_techo_deuda;
        -- v_nuevo_saldo permanece intacto (el flete ya fue retenido en físico)

        INSERT INTO public.delivery_transactions (driver_id, order_id, amount, type, notes)
        VALUES (p_driver_id, p_order_id, GREATEST(0, v_monto_total - v_flete_ganado), 'cash_debt', 'Cobro neto de comida a entregar en caja');

        INSERT INTO public.delivery_transactions (driver_id, order_id, amount, type, notes)
        VALUES (p_driver_id, p_order_id, v_flete_ganado, 'delivery_fee_offset', 'Flete retenido en efectivo por el repartidor');
    ELSE
        -- Métodos digitales: Acreditar ganancia de flete
        v_nuevo_saldo := ROUND(v_nuevo_saldo + v_flete_ganado, 2);

        INSERT INTO public.delivery_transactions (driver_id, order_id, amount, type, notes)
        VALUES (p_driver_id, p_order_id, v_flete_ganado, 'delivery_fee_credit', 'Flete acreditado por pedido digital');
    END IF;

    -- Asentar venta neta (90%) en el balance acumulado del restaurante (efectivo o digital)
    IF v_order.business_id IS NOT NULL AND v_subtotal_food > 0 THEN
        UPDATE public.businesses
        SET balance = COALESCE(balance, 0) + ROUND(v_subtotal_food * 0.90, 2),
            total_sales = COALESCE(total_sales, 0) + v_subtotal_food
        WHERE id = v_order.business_id;
    END IF;

    -- Actualizar billetera de forma blindada
    UPDATE public.delivery_wallets
    SET cash_debt = v_nueva_deuda,
        prepaid_balance = v_nuevo_saldo,
        is_blocked = v_is_blocked
    WHERE driver_id = p_driver_id;

    -- Actualizar estado de orden a entregado
    UPDATE public.orders
    SET status = 'delivered',
        delivery_status = 'delivered',
        delivered_at = COALESCE(delivered_at, NOW())
    WHERE id = p_order_id;

    -- Log de auditoría financiera
    INSERT INTO public.security_audit_logs (event_type, severity, details)
    VALUES ('FINANCIAL_SETTLEMENT_SUCCESS', 'info', jsonb_build_object(
        'order_id', p_order_id,
        'driver_id', p_driver_id,
        'payment_method', v_order.payment_method,
        'nueva_deuda', v_nueva_deuda,
        'nuevo_saldo', v_nuevo_saldo,
        'is_blocked', v_is_blocked
    ));

    RETURN jsonb_build_object(
        'success', TRUE,
        'cash_debt', v_nueva_deuda,
        'prepaid_balance', v_nuevo_saldo,
        'is_blocked', v_is_blocked
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 17.8 INCREMENTAR BALANCE DEL RESTAURANTE (SOPORTE PICKUP / FALLBACK SEGURO)
CREATE OR REPLACE FUNCTION public.increment_business_balance(
    b_id UUID,
    amount NUMERIC
) RETURNS VOID AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED';
    END IF;
    UPDATE public.businesses
    SET balance = COALESCE(balance, 0) + COALESCE(amount, 0)
    WHERE id = b_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 17.9 AMORTIZACIÓN SEGURA DE DEUDA CON SALDO A FAVOR DEL REPARTIDOR
CREATE OR REPLACE FUNCTION public.amortizar_deuda_con_saldo_seguro(
    p_driver_id UUID,
    p_monto NUMERIC
) RETURNS JSONB AS $$
DECLARE
    v_wallet RECORD;
    v_abono NUMERIC;
    v_nuevo_saldo NUMERIC;
    v_nueva_deuda NUMERIC;
    v_is_blocked BOOLEAN;
BEGIN
    IF auth.uid() IS DISTINCT FROM p_driver_id AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED';
    END IF;

    SELECT * INTO v_wallet FROM public.delivery_wallets WHERE driver_id = p_driver_id FOR UPDATE;
    IF v_wallet IS NULL THEN
        RAISE EXCEPTION 'WALLET_NOT_FOUND';
    END IF;

    v_abono := ROUND(LEAST(COALESCE(v_wallet.prepaid_balance, 0), COALESCE(v_wallet.cash_debt, 0), COALESCE(p_monto, 0)), 2);
    IF v_abono <= 0 THEN
        RAISE EXCEPTION 'INVALID_AMORTIZATION: No hay saldo o deuda disponible para amortizar.';
    END IF;

    v_nuevo_saldo := ROUND(COALESCE(v_wallet.prepaid_balance, 0) - v_abono, 2);
    v_nueva_deuda := ROUND(COALESCE(v_wallet.cash_debt, 0) - v_abono, 2);
    v_is_blocked := v_nueva_deuda >= COALESCE(v_wallet.debt_ceiling, 25.00);

    UPDATE public.delivery_wallets
    SET prepaid_balance = v_nuevo_saldo,
        cash_debt = v_nueva_deuda,
        is_blocked = v_is_blocked
    WHERE driver_id = p_driver_id
    RETURNING * INTO v_wallet;

    INSERT INTO public.delivery_transactions (driver_id, amount, type, notes)
    VALUES (p_driver_id, v_abono, 'debt_payment', 'Amortización segura con saldo a favor');

    RETURN jsonb_build_object(
        'success', TRUE,
        'abono_real', v_abono,
        'wallet', to_jsonb(v_wallet)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 17.10 SOLICITUD ATÓMICA DE RETIRO PAGO MÓVIL PARA REPARTIDORES (ZERO-TRUST RLS)
CREATE OR REPLACE FUNCTION public.solicitar_retiro_driver_seguro(
    p_driver_id UUID,
    p_amount NUMERIC,
    p_bank_name TEXT,
    p_id_doc TEXT,
    p_phone TEXT
) RETURNS JSONB AS $$
DECLARE
    v_wallet RECORD;
    v_withdrawal RECORD;
    v_monto NUMERIC := ROUND(COALESCE(p_amount, 0), 2);
    v_nuevo_saldo NUMERIC;
BEGIN
    IF auth.uid() IS DISTINCT FROM p_driver_id AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED: No puedes solicitar retiros para otro repartidor.';
    END IF;

    IF v_monto <= 0 THEN
        RAISE EXCEPTION 'INVALID_AMOUNT: El monto del retiro debe ser mayor a 0.';
    END IF;

    SELECT * INTO v_wallet FROM public.delivery_wallets WHERE driver_id = p_driver_id FOR UPDATE;
    IF v_wallet IS NULL THEN
        RAISE EXCEPTION 'WALLET_NOT_FOUND: Billetera del repartidor no encontrada.';
    END IF;

    IF v_monto > COALESCE(v_wallet.prepaid_balance, 0) THEN
        RAISE EXCEPTION 'INSUFFICIENT_BALANCE: El monto solicitado supera tu saldo disponible.';
    END IF;

    v_nuevo_saldo := ROUND(COALESCE(v_wallet.prepaid_balance, 0) - v_monto, 2);

    UPDATE public.delivery_wallets
    SET prepaid_balance = v_nuevo_saldo
    WHERE driver_id = p_driver_id
    RETURNING * INTO v_wallet;

    INSERT INTO public.driver_withdrawals (driver_id, amount, bank_name, id_doc, phone, status)
    VALUES (p_driver_id, v_monto, p_bank_name, p_id_doc, p_phone, 'pending')
    RETURNING * INTO v_withdrawal;

    INSERT INTO public.delivery_transactions (driver_id, amount, type, notes)
    VALUES (p_driver_id, v_monto, 'withdrawal', 'Solicitud de retiro Pago Móvil retenida para transferencia');

    RETURN jsonb_build_object(
        'success', TRUE,
        'withdrawal', to_jsonb(v_withdrawal),
        'wallet', to_jsonb(v_wallet)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;





