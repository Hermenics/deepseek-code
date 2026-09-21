import type { Currency } from '../config/currencies'
import { parseAmount } from '../money/parse'
import type { Money } from '../money/types'
import { findProduct } from './products'

export function unitPrice(sku: string, currency: Currency): Money {
  const text = findProduct(sku).prices[currency]
  if (text === undefined) throw new Error(`${sku} is not sold in ${currency}`)
  return parseAmount(text, currency)
}
