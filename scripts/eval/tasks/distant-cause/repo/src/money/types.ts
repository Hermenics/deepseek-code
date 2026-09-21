import type { Currency } from '../config/currencies'

/** An amount in the currency's smallest unit (cents for USD, yen for JPY, fils for KWD). */
export interface Money {
  minor: number
  currency: Currency
}
