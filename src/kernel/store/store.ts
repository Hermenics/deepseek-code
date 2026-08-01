import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync } from 'node:fs'
import { runMigrations, type Migration } from './migrations.js'

export interface StoreOptions {
  path?: string
  memory?: boolean
}

export class Store {
  readonly db: Database
  readonly path: string

  constructor(options: StoreOptions = {}) {
    if (options.memory) {
      this.path = ':memory:'
    } else {
      this.path = options.path ?? join(homedir(), '.deepseek', 'kernel.db')
      mkdirSync(join(homedir(), '.deepseek'), { recursive: true })
    }

    this.db = new Database(this.path, { create: true })
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA secure_delete = ON')
  }

  migrate(migrations: Migration[]): void {
    runMigrations(this.db, migrations)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  /** Run a query with positional `?` params. Returns array of rows. */
  query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    if (params.length > 0) {
      // bun:sqlite uses positional args for `?` bindings
      const stmt = this.db.query(sql)
      return (stmt as unknown as { all(...args: unknown[]): T[] }).all(...params) as T[]
    }
    return this.db.query(sql).all() as T[]
  }

  /** Run a mutation with positional `?` params. */
  run(sql: string, ...params: unknown[]): void {
    if (params.length > 0) {
      const stmt = this.db.query(sql)
      ;(stmt as unknown as { run(...args: unknown[]): void }).run(...params)
    } else {
      this.db.run(sql)
    }
  }

  /** Execute within a transaction. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  close(): void {
    this.db.close()
  }
}
