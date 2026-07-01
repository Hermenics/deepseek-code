# Utils Module — Requirements

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Overview

The Utils module provides shared filesystem utilities and general helpers used across multiple modules.

## Functional Requirements

### FR-01: File System Utilities 🟢
- **Must** provide `readJson<T>(path)` — read and parse JSON file with type safety
- **Must** provide `globFiles(pattern, dir)` — find files matching regex in directory
- **Must** handle missing files gracefully (return null/empty)

### FR-02: General Utilities 🟡
- **Should** provide any shared string/path manipulation helpers used across modules
