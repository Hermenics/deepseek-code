import { MINOR_UNITS, SYMBOLS } from '../config/currencies'
import type { Money } from './types'

/** Adds thousands separators to a string of digits. */
function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Formats an amount with its currency symbol and decimal places. */
export function formatMoney(money: Money): string {
  const digits = MINOR_UNITS[money.currency]
  const sign = money.minor < 0 ? '-' : ''
  const abs = Math.abs(money.minor)
  const whole = group(String(Math.floor(abs / 10 ** digits)))
  const fraction = digits > 0 ? `.${String(abs % 10 ** digits).padStart(digits, '0')}` : ''
  return `${sign}${SYMBOLS[money.currency]}${whole}${fraction}`
}
