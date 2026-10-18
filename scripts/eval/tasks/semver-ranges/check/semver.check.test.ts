import { expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { findExecutableTestCallbacks, structuralTestBodyText } from './testEvidence.js'
import { satisfies } from '../src/semver'

/** Checks each [range, version, expected] triple, reporting the failing case by name. */
const cases = (list: Array<[string, string, boolean]>) => {
  for (const [range, version, expected] of list) expect({ range, version, ok: satisfies(version, range) }).toEqual({ range, version, ok: expected })
}

it('caret ranges', () => cases([
  ['^1.2.3', '1.9.9', true], ['^1.2.3', '2.0.0', false], ['^1.2.3', '1.2.2', false],
  ['^0.2.3', '0.2.9', true], ['^0.2.3', '0.3.0', false],
  ['^0.0.3', '0.0.3', true], ['^0.0.3', '0.0.4', false],
  ['^1.2', '1.4.0', true], ['^0.x', '0.9.0', true], ['^0.x', '1.0.0', false],
]))

it('tilde ranges', () => cases([
  ['~1.2.3', '1.2.9', true], ['~1.2.3', '1.3.0', false],
  ['~1.2', '1.2.0', true], ['~1.2', '1.3.0', false],
  ['~1', '1.9.0', true], ['~1', '2.0.0', false],
  ['~0.2.3', '0.2.5', true],
]))

it('X-ranges and partial versions', () => cases([
  ['*', '3.4.5', true], ['', '0.0.1', true], ['1.x', '1.99.0', true], ['1.x', '2.0.0', false],
  ['1.2.*', '1.2.7', true], ['1.2.*', '1.3.0', false], ['1.2', '1.2.4', true], ['1', '1.0.0', true], ['1', '0.9.9', false],
]))

it('alternatives and intersections', () => cases([
  ['^1.0.0 || ^3.0.0', '3.1.0', true], ['^1.0.0 || ^3.0.0', '2.1.0', false],
  ['>=1.2.0 <1.5.0 || 2.x', '1.4.0', true], ['>=1.2.0 <1.5.0 || 2.x', '1.6.0', false], ['>=1.2.0 <1.5.0 || 2.x', '2.3.0', true],
]))

it('prereleases only match a comparator on the same version tuple', () => cases([
  ['^1.2.3-beta.2', '1.2.3-beta.4', true], ['^1.2.3-beta.2', '1.2.3-beta.1', false],
  ['^1.2.3-beta.2', '1.2.4-beta.1', false], ['^1.2.3-beta.2', '1.3.0', true],
  ['^1.2.3', '1.3.0-beta.1', false], ['*', '1.0.0-rc.1', false],
  ['>=1.2.3-alpha.1 <1.3.0', '1.2.3-alpha.7', true], ['>=1.2.3-alpha.1 <1.3.0', '1.2.4-alpha.1', false],
  ['~1.2.3-rc.1', '1.2.3', true],
]))

function testCallbacks() {
  const tests = readdirSync('.', { recursive: true }).map(String)
    .filter((f) => /\.(test|spec)\.[jt]sx?$/.test(f) && !f.includes('__eval_check__') && !f.includes('node_modules'))
    .map((fileName) => ({ fileName, text: readFileSync(fileName, 'utf8') }))
  return findExecutableTestCallbacks(tests)
}

function hasCaretOrTildeRange(callback: ReturnType<typeof findExecutableTestCallbacks>[number]): boolean {
  const ranges = new Map<string, string>()
  const literalString = (node: ts.Expression | undefined): string | undefined => {
    if (!node) return undefined
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      return literalString(node.expression)
    }
    return undefined
  }
  const collectRanges = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const value = literalString(node.initializer)
      if (value !== undefined) ranges.set(node.name.text, value)
    }
    ts.forEachChild(node, collectRanges)
  }
  collectRanges(callback.body)

  let foundRange = false
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'satisfies') {
      const rangeArgument = node.arguments[1]
      const range = literalString(rangeArgument)
        ?? (rangeArgument && ts.isIdentifier(rangeArgument) ? ranges.get(rangeArgument.text) : undefined)
      if (range && /[~^]\d/.test(range)) foundRange = true
    }
    ts.forEachChild(node, visit)
  }
  visit(callback.body)
  const body = structuralTestBodyText(callback)
  return foundRange && /\bsatisfies\s*\(/.test(body) && /\bexpect\s*\(/.test(body)
}

it('adds tests for the new ranges', () => {
  expect(testCallbacks().some(hasCaretOrTildeRange)).toBe(true)
})
