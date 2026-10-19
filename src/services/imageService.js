// Servicio de resolución de fotos de platos para Tropicalia CRB
// Provee imágenes de alta resolución gastronómica cuando el plato no tiene image_url cargada en Supabase

const FOOD_PHOTOS = {
  burger: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&auto=format&fit=crop&q=80',
  fries: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=600&auto=format&fit=crop&q=80',
  pizzaPepperoni: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=600&auto=format&fit=crop&q=80',
  pizzaMargarita: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&auto=format&fit=crop&q=80',
  sushi: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=600&auto=format&fit=crop&q=80',
  ratatouille: 'https://images.unsplash.com/photo-1572441713132-c542fc4fe282?w=600&auto=format&fit=crop&q=80',
  tiramisu: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=600&auto=format&fit=crop&q=80',
  mousse: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600&auto=format&fit=crop&q=80',
  fresa: 'https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?w=600&auto=format&fit=crop&q=80',
  parchita: 'https://images.unsplash.com/photo-1587314168485-3236d6710814?w=600&auto=format&fit=crop&q=80',
  vainilla: 'https://images.unsplash.com/photo-1587314168485-3236d6710814?w=600&auto=format&fit=crop&q=80',
  drinks: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=600&auto=format&fit=crop&q=80',
  default: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80',
};

export function getProductImageUrl(product) {
  if (product?.image_url && typeof product.image_url === 'string' && product.image_url.startsWith('http')) {
    return product.image_url;
  }

  const name = (product?.name || '').toLowerCase();

  if (name.includes('hamburguesa') || name.includes('burger')) return FOOD_PHOTOS.burger;
  if (name.includes('papa') || name.includes('fries') || name.includes('rústica')) return FOOD_PHOTOS.fries;
  if (name.includes('pepperoni')) return FOOD_PHOTOS.pizzaPepperoni;
  if (name.includes('pizza') || name.includes('margarita')) return FOOD_PHOTOS.pizzaMargarita;
  if (name.includes('sushi') || name.includes('roll')) return FOOD_PHOTOS.sushi;
  if (name.includes('ratatouille')) return FOOD_PHOTOS.ratatouille;
  if (name.includes('tiramis') || name.includes('café') || name.includes('cafe')) return FOOD_PHOTOS.tiramisu;
  if (name.includes('fresa')) return FOOD_PHOTOS.fresa;
  if (name.includes('parchita')) return FOOD_PHOTOS.parchita;
  if (name.includes('mousse') || name.includes('choc')) return FOOD_PHOTOS.mousse;
  if (name.includes('vainilla')) return FOOD_PHOTOS.vainilla;
  if (name.includes('bebida') || name.includes('jugo') || name.includes('refresco')) return FOOD_PHOTOS.drinks;

  return FOOD_PHOTOS.default;
}
