export interface StreamRecord {
  sequence: number
  text: string
}

export interface SimulatedOutput {
  stdout: StreamRecord[]
  stderr: StreamRecord[]
}

export function simulateBuildOutput(): SimulatedOutput {
  return {
    stdout: [
      { sequence: 1, text: 'build: compiling packages' },
      { sequence: 4, text: 'ERROR[RUN-88]: parent observed the worker failure' },
    ],
    stderr: [
      { sequence: 2, text: 'ERROR[PKG-17]: missing runtime export ./codec' },
      { sequence: 3, text: 'hint: inspect the package export map' },
      { sequence: 5, text: 'FATAL: build exited with code 1' },
    ],
  }
}
