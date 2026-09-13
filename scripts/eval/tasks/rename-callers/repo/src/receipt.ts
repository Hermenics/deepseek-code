import * as money from './money'

export function receipt(lines: [string, number][]): string {
  return lines.map(([name, cents]) => `${name.padEnd(12)}${money.fmt(cents)}`).join('\n')
}
