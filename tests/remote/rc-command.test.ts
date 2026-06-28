import { describe, it, expect } from 'bun:test'
import { parseCommand } from '../../src/commands/index.js'

describe('/rc command', () => {
  it('/rc returns start action', () => {
    expect(parseCommand('/rc')).toEqual({ type: 'remote-control', action: 'start' })
  })

  it('/rc start returns start action', () => {
    expect(parseCommand('/rc start')).toEqual({ type: 'remote-control', action: 'start' })
  })

  it('/rc stop returns stop action', () => {
    expect(parseCommand('/rc stop')).toEqual({ type: 'remote-control', action: 'stop' })
  })

  it('/rc status returns status action', () => {
    expect(parseCommand('/rc status')).toEqual({ type: 'remote-control', action: 'status' })
  })

  it('/rc devices returns devices action', () => {
    expect(parseCommand('/rc devices')).toEqual({ type: 'remote-control', action: 'devices' })
  })

  it('/rc unpair returns unpair without deviceId', () => {
    expect(parseCommand('/rc unpair')).toEqual({ type: 'remote-control', action: 'unpair', deviceId: undefined })
  })

  it('/rc unpair <id> returns unpair with deviceId', () => {
    expect(parseCommand('/rc unpair abc123')).toEqual({ type: 'remote-control', action: 'unpair', deviceId: 'abc123' })
  })

  it('/remote-control alias works', () => {
    expect(parseCommand('/remote-control start')).toEqual({ type: 'remote-control', action: 'start' })
  })

  it('unknown subcommand returns unknown type', () => {
    const result = parseCommand('/rc bogus')
    expect(result?.type).toBe('unknown')
  })
})
