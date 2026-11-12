import React from 'react';
import {
  Search,
  MapPin,
  Clock,
  Sparkles,
  ShoppingBag,
  ShoppingCart,
  Store,
  ChefHat,
  Bike,
  Shield,
  ShieldCheck,
  User,
  Check,
  CheckCircle2,
  X,
  XCircle,
  Plus,
  Minus,
  Navigation,
  RefreshCw,
  Gift,
  Home as HomeIcon,
  Briefcase,
  Paperclip,
  ArrowRight,
  ArrowDownCircle,
  Settings,
  CreditCard,
  DollarSign,
  TrendingUp,
  Flame,
  KeyRound,
  Lock,
  Landmark,
  ExternalLink,
  ClipboardList,
  Package,
  PackageCheck,
  AlertTriangle,
  Info,
  Phone,
  Bell,
  Mail,
  Headphones,
  Eye,
  EyeOff,
  Trash2,
  Heart,
  Star
} from 'lucide-react';

/**
 * Paleta oficial Tropicalia:
 * Vino: #82133a
 * Violeta Oscuro: #571846
 * Mango: #ef9d24
 */
export const COLOR_VINO = '#82133a';
export const COLOR_VIOLETA = '#571846';
export const COLOR_MANGO = '#ef9d24';

/**
 * Icono Oficial WhatsApp (Vector limpio con marca oficial)
 */
export function WhatsAppIcon({ size = 20, color = '#25D366', style = {}, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
    </svg>
  );
}

/**
 * Icono de Favorito (Corazón minimalista con contorno en color vino #82133a)
 * Requisito explícito: "El icono de favorito (corazón) en los platos debe ser un diseño plano,
 * minimalista y únicamente con contorno de color vino."
 */
export function HeartOutlineIcon({ size = 18, active = false, color = COLOR_VINO, style = {} }) {
  return (
    <Heart
      size={size}
      color={color}
      fill={active ? color : 'none'}
      strokeWidth={active ? 2 : 1.8}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      aria-hidden="true"
    />
  );
}

/**
 * Icono de Calificación (Estrella plana con contorno en color mango #ef9d24)
 * Requisito explícito: "La estrella de calificación debe ser plana y únicamente con contorno de color mango."
 */
export function StarOutlineIcon({ size = 14, color = COLOR_MANGO, fill = 'none', style = {} }) {
  return (
    <Star
      size={size}
      color={color}
      fill={fill}
      strokeWidth={1.8}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      aria-hidden="true"
    />
  );
}

/**
 * Icono de Papelera Plano en color vino (#82133a)
 * Requisito explícito: "En las listas de direcciones o elementos de eliminación,
 * no utilices emojis de papelera; usa un icono vectorial plano de color vino."
 */
export function TrashVinoIcon({ size = 16, color = COLOR_VINO, style = {}, className = '' }) {
  return (
    <Trash2
      size={size}
      color={color}
      strokeWidth={1.9}
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      aria-hidden="true"
    />
  );
}

/**
 * Iconos de Visibilidad de Contraseña (Ojo Abierto / Cerrado en color vino #82133a)
 * Requisito explícito: "En los campos de entrada de contraseña (actual y nueva), no utilices emojis de monito;
 * usa iconos vectoriales planos de ojo abierto y ojo cerrado en color vino para alternar la visibilidad de la clave."
 */
export function EyeOpenVinoIcon({ size = 19, color = COLOR_VINO, style = {} }) {
  return (
    <Eye
      size={size}
      color={color}
      strokeWidth={2}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      aria-hidden="true"
    />
  );
}

export function EyeClosedVinoIcon({ size = 19, color = COLOR_VINO, style = {} }) {
  return (
    <EyeOff
      size={size}
      color={color}
      strokeWidth={2}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      aria-hidden="true"
    />
  );
}

// Re-exportamos los iconos de Lucide más utilizados para uniformidad global
export {
  Search,
  MapPin,
  Clock,
  Sparkles,
  ShoppingBag,
  ShoppingCart,
  Store,
  ChefHat,
  Bike,
  Shield,
  ShieldCheck,
  User,
  Check,
  CheckCircle2,
  X,
  XCircle,
  Plus,
  Minus,
  Navigation,
  RefreshCw,
  Gift,
  HomeIcon,
  Briefcase,
  Paperclip,
  ArrowRight,
  ArrowDownCircle,
  Settings,
  CreditCard,
  DollarSign,
  TrendingUp,
  Flame,
  KeyRound,
  Lock,
  Landmark,
  ExternalLink,
  ClipboardList,
  Package,
  PackageCheck,
  AlertTriangle,
  Info,
  Phone,
  Bell,
  Mail,
  Headphones
};
