import { fmt } from './money'

export function cartTotal(items: { price: number; qty: number }[]): string {
  return fmt(items.reduce((sum, item) => sum + item.price * item.qty, 0))
}
