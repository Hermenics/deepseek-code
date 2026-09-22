import type { Currency } from '../config/currencies'
import { parseAmount } from '../money/parse'
import type { Money } from '../money/types'

const FLAT_FEES: Record<Currency, string> = { USD: '5.00', EUR: '4.50', JPY: '600', KWD: '1.500' }
const FREE_OVER: Record<Currency, string> = { USD: '50.00', EUR: '45.00', JPY: '7000', KWD: '15.000' }

/** Flat shipping fee, waived once the subtotal reaches the free-shipping threshold. */
export function shippingFee(currency: Currency, subtotal: Money): Money {
  const threshold = parseAmount(FREE_OVER[currency], currency)
  return subtotal.minor >= threshold.minor ? { minor: 0, currency } : parseAmount(FLAT_FEES[currency], currency)
}
