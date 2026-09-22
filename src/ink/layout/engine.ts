import type { LayoutNode } from './node.js'
import { createYogaLayoutNode } from './yoga.js'

/** Creates a layout node; the single place that picks the engine (currently Yoga). */
export function createLayoutNode(): LayoutNode {
  return createYogaLayoutNode()
}
