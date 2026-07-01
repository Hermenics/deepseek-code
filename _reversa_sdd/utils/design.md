# Utils Module — Design

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Architecture

Minimal utility module providing filesystem helpers consumed by other modules.

## Structure

```
utils/
└── fs.ts    — readJson(), globFiles()
```

## Key Functions

```typescript
async function readJson<T>(path: string): Promise<T | null>
// Read file, JSON.parse, return typed. Returns null on error.

async function globFiles(pattern: RegExp, dir: string): Promise<string[]>
// List files in dir matching regex pattern.
```
