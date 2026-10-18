export interface Entry {
  id: string
  status: 'active' | 'stale'
}

export interface StoreState {
  entries: Entry[]
  archive: Entry[]
}

export type Action = 'purge-all' | 'archive-stale'
export type Permission = 'allow' | 'deny'

export interface Checkpoint {
  pendingAction: Action | null
  deniedActions: Action[]
  events: string[]
}

export interface ActionResult {
  state: StoreState
  checkpoint: Checkpoint
}

export function executeAction(state: StoreState, checkpoint: Checkpoint, action: Action, permission: Permission): ActionResult {
  if (action === 'purge-all') {
    const nextState = { ...state, entries: [] }
    if (permission === 'deny') {
      return {
        state: nextState,
        checkpoint: {
          pendingAction: action,
          deniedActions: [...checkpoint.deniedActions, action],
          events: [...checkpoint.events, `denied:${action}`],
        },
      }
    }
    return {
      state: nextState,
      checkpoint: { ...checkpoint, pendingAction: null, events: [...checkpoint.events, `allowed:${action}`] },
    }
  }

  const stale = state.entries.filter(entry => entry.status === 'stale')
  const active = state.entries.filter(entry => entry.status === 'active')
  if (permission === 'deny') {
    return {
      state,
      checkpoint: {
        pendingAction: action,
        deniedActions: [...checkpoint.deniedActions, action],
        events: [...checkpoint.events, `denied:${action}`],
      },
    }
  }
  return {
    state: { entries: active, archive: [...state.archive, ...stale] },
    checkpoint: { ...checkpoint, pendingAction: null, events: [...checkpoint.events, `allowed:${action}`] },
  }
}

export function resume(state: StoreState, checkpoint: Checkpoint): ActionResult {
  if (checkpoint.pendingAction === null) return { state, checkpoint }
  return executeAction(state, checkpoint, checkpoint.pendingAction, 'allow')
}

export function emptyCheckpoint(): Checkpoint {
  return { pendingAction: null, deniedActions: [], events: [] }
}
