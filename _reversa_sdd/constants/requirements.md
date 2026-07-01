# Constants Module — Requirements

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Overview

The Constants module centralizes all magic numbers and configuration defaults used across the system.

## Functional Requirements

### FR-01: Agent Constants 🟢
- `UNDO_STACK_MAX` = 10 (file checkpoints)
- `CONTEXT_COMPACT_THRESHOLD` = 0.85 (85%)
- `AUTO_COMPACT_BUFFER_TOKENS` = 13,000
- `MICRO_COMPACT_KEEP_LAST` = 5
- `CHECKPOINT_MAX` = 20
- `REFINER_MAX_TOKENS` = 1024
- `REFINER_MIN_LENGTH` = 30

### FR-02: Tool Constants 🟢
- `SHELL_OUTPUT_MAX_CHARS` = 50,000
- `SHELL_TIMEOUT_MS` = 30,000
- `GREP_MAX_LINES` = 200
- `GLOB_MAX_FILES` = 500
- `SUBAGENT_MAX_ITERATIONS` = 15

### FR-03: Product Constants 🟢
- `PRODUCT_NAME` = 'DeepSeek Code'
- `PRODUCT_CLI_NAME` = 'deepseek'
- `CONFIG_DIR` = '.deepseek'

### FR-04: UI Constants 🟢
- `DIFF_MAX_LINES` = 50
