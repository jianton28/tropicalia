-- ==============================================================================
-- TROPICALIA CRB - MIGRACIÓN: BOM, COSTOS OCR, STOCK VS ENCARGO Y COMISIONES 3/2/1
-- ==============================================================================
-- Ejecutar en Supabase SQL Editor para habilitar las nuevas columnas y RPCs.

-- 1. Costos unitarios en inventario para cálculo automático de BOM e inflación
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12, 4) DEFAULT 0.0000,
  ADD COLUMN IF NOT EXISTS last_cost_updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Dualidad de Producción en platos: 'stock' (Lotes Anticipados) vs 'on_demand' (Por Encargo)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS production_mode TEXT DEFAULT 'on_demand',
  ADD COLUMN IF NOT EXISTS ready_stock INTEGER DEFAULT 0;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_production_mode_check;
ALTER TABLE public.products ADD CONSTRAINT products_production_mode_check
  CHECK (production_mode IN ('stock', 'on_demand'));

-- 3. Desglose transparente de comisiones 3% cocina / 2% delivery / 1% usuario en órdenes
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS kitchen_commission NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS delivery_commission NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS user_fee NUMERIC(10, 2) DEFAULT 0.00;
