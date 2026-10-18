export function updateTarget(json: string, value: string): string {
  return json.replace('"value":"old"', `"value":"${value}"`)
}
