// Context compaction service — re-exports from agent for now
// Future: move full compaction logic here
export { COMPACT_BOUNDARY_ROLE, isBoundaryMarker, createBoundaryMarker, getMessagesAfterBoundary } from '../../agent/compactBoundary.js'
