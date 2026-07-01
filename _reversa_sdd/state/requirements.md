# State Module — Requirements

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Overview

The State module provides a minimal reactive store for shared application state. It uses a singleton pattern with subscribe/notify for cross-component updates.

## Functional Requirements

### FR-01: State Management 🟢
- **Must** provide getState(), setState(), subscribe(), resetState()
- **Must** notify all subscribers on state change
- **Must** support partial updates (merge semantics)

### FR-02: State Shape 🟢
- **Must** track: sessionId, provider, model, tokenCount, contextUsage, contextLimit, activeAgent, isProcessing

## Non-Functional Requirements

### NFR-01: Simplicity 🟢
- No external state management library
- Plain object with subscriber set
- Synchronous updates
