import type { Currency } from '../config/currencies'

export interface Product {
  sku: string
  name: string
  /** List prices as entered by the merchandising team, per currency. */
  prices: Partial<Record<Currency, string>>
}

export const PRODUCTS: Product[] = [
  { sku: 'TEA-01', name: 'Sencha tea', prices: { USD: '12.50', EUR: '11.00', JPY: '1500', KWD: '3.850' } },
  { sku: 'CUP-02', name: 'Stoneware cup', prices: { USD: '8.00', EUR: '7.40', JPY: '980', KWD: '2.475' } },
  { sku: 'POT-03', name: 'Cast iron pot', prices: { USD: '45.99', EUR: '42.00', JPY: '6800', KWD: '14.125' } },
]

/** Product by SKU; throws for an unknown one. */
export function findProduct(sku: string): Product {
  const product = PRODUCTS.find((p) => p.sku === sku)
  if (!product) throw new Error(`unknown sku: ${sku}`)
  return product
}
