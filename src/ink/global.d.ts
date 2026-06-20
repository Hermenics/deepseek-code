// Global type declarations for Ink custom JSX elements and missing modules

declare module 'react/compiler-runtime' {
  export function c(size: number): any[]
}

declare module 'bidi-js' {
  const bidiFactory: any
  export default bidiFactory
}

declare module 'lodash-es/noop.js' {
  const noop: (...args: any[]) => void
  export default noop
}

declare module 'lodash-es/throttle.js' {
  const throttle: (fn: (...args: any[]) => any, wait?: number, options?: any) => any
  export default throttle
}

declare module 'react-reconciler' {
  const createReconciler: any
  export default createReconciler
  export type FiberRoot = any
}

declare module 'react-reconciler/constants.js' {
  export const ConcurrentRoot: number
  export const LegacyRoot: number
  export const ContinuousEventPriority: number
  export const DefaultEventPriority: number
  export const DiscreteEventPriority: number
  export const NoEventPriority: number
}

// Ink custom JSX elements — extend react/jsx-runtime's IntrinsicElements
declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': any
      'ink-text': any
      'ink-virtual-text': any
      'ink-link': any
      'ink-raw-ansi': any
    }
  }
}

declare module 'react/jsx-dev-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': any
      'ink-text': any
      'ink-virtual-text': any
      'ink-link': any
      'ink-raw-ansi': any
    }
  }
}
