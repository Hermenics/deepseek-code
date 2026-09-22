export type Currency = 'USD' | 'EUR' | 'JPY' | 'KWD'

/** Digits after the decimal point in each currency's smallest unit (ISO 4217). */
export const MINOR_UNITS: Record<Currency, number> = { USD: 2, EUR: 2, JPY: 0, KWD: 3 }

export const SYMBOLS: Record<Currency, string> = { USD: '$', EUR: '€', JPY: '¥', KWD: 'KWD ' }
