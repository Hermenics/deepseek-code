import { describe, it, expect } from 'bun:test'
import { dequeueWithPriority, dropGoalContinuations, enqueue, dequeue, getObjectiveRevision, getSteerInstruction, isObjectiveRevisionDurable, MAX_QUEUE_SIZE, runWithObjectiveRevisionGuard, serializeAsync } from '../src/ui/queueLogic.js'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('queueLogic', () => {
  describe('MAX_QUEUE_SIZE', () => {
    it('should be 10', () => {
      expect(MAX_QUEUE_SIZE).toBe(10)
    })
  })

  describe('enqueue()', () => {
    it('should add message to empty queue', () => {
      // Arrange + Act
      const result = enqueue([], 'hello')

      // Assert
      expect(result).toEqual(['hello'])
    })

    it('should append message to end of existing queue (FIFO)', () => {
      // Arrange + Act
      const result = enqueue(['first'], 'second')

      // Assert
      expect(result).toEqual(['first', 'second'])
    })

    it('should maintain FIFO order with multiple sequential enqueues', () => {
      // Arrange
      let queue: string[] = []

      // Act
      queue = enqueue(queue, 'msg1')
      queue = enqueue(queue, 'msg2')
      queue = enqueue(queue, 'msg3')

      // Assert
      expect(queue).toEqual(['msg1', 'msg2', 'msg3'])
    })

    it('should not mutate the original queue array', () => {
      // Arrange
      const original = ['existing']

      // Act
      enqueue(original, 'new')

      // Assert
      expect(original).toEqual(['existing'])
    })

    it('should reject enqueue when queue is at MAX_QUEUE_SIZE', () => {
      // Arrange
      const full = Array.from({ length: MAX_QUEUE_SIZE }, (_, i) => `msg${i}`)

      // Act
      const result = enqueue(full, 'overflow')

      // Assert — queue unchanged
      expect(result).toEqual(full)
      expect(result.length).toBe(MAX_QUEUE_SIZE)
    })
  })

  describe('dequeue()', () => {
    it('should return null and empty array when queue is empty', () => {
      // Arrange + Act
      const result = dequeue([])

      // Assert
      expect(result.next).toBeNull()
      expect(result.remaining).toEqual([])
    })

    it('should return first message and the rest of the queue', () => {
      // Arrange + Act
      const result = dequeue(['first', 'second', 'third'])

      // Assert
      expect(result.next).toBe('first')
      expect(result.remaining).toEqual(['second', 'third'])
    })

    it('should return the only message and empty remaining when queue has one item', () => {
      // Arrange + Act
      const result = dequeue(['only'])

      // Assert
      expect(result.next).toBe('only')
      expect(result.remaining).toEqual([])
    })

    it('should not mutate the original queue array', () => {
      // Arrange
      const original = ['a', 'b']

      // Act
      dequeue(original)

      // Assert
      expect(original).toEqual(['a', 'b'])
    })
  })

  describe('priority messages', () => {
    it('dispatches an objective replacement before normal queued messages without reordering them', () => {
      const original = ['first ordinary message', 'second ordinary message']
      const priority = dequeueWithPriority(original, 'revised objective')

      expect(priority).toEqual({ next: 'revised objective', remaining: original })
      expect(dequeue(priority.remaining)).toEqual({ next: 'first ordinary message', remaining: ['second ordinary message'] })
      expect(original).toEqual(['first ordinary message', 'second ordinary message'])
    })

    it('keeps the regular queue FIFO when no replacement is pending', () => {
      expect(dequeueWithPriority(['first', 'second'], null)).toEqual({ next: 'first', remaining: ['second'] })
    })

    it('removes only synthetic goal continuations when an objective changes', () => {
      const queue = [
        { text: 'ordinary request' },
        { text: '[Goal continuation 3/10]\nContinue the old objective' },
        { text: 'another ordinary request' },
      ]

      expect(dropGoalContinuations(queue)).toEqual([queue[0], queue[2]])
      expect(queue).toHaveLength(3)
    })
  })

  describe('serialized persistence', () => {
    it('writes repeated objective checkpoints in call order', async () => {
      const tail = { current: Promise.resolve() }
      const firstMayFinish = deferred<void>()
      const writes: string[] = []
      const first = serializeAsync(tail, async () => {
        writes.push('revision 1 started')
        await firstMayFinish.promise
        writes.push('revision 1 finished')
      })
      const second = serializeAsync(tail, async () => { writes.push('revision 2 finished') })

      await Promise.resolve()
      expect(writes).toEqual(['revision 1 started'])
      firstMayFinish.resolve()
      await Promise.all([first, second])

      expect(writes).toEqual(['revision 1 started', 'revision 1 finished', 'revision 2 finished'])
    })

    it('continues later revision checkpoints after an earlier write fails', async () => {
      const tail = { current: Promise.resolve() }
      const writes: string[] = []
      const first = serializeAsync(tail, async () => { writes.push('revision 1'); throw new Error('checkpoint failed') })
      const second = serializeAsync(tail, async () => { writes.push('revision 2') })

      await expect(first).rejects.toThrow('checkpoint failed')
      await second
      expect(writes).toEqual(['revision 1', 'revision 2'])
    })

    it('does not let a queued autosave make a failed objective revision durable', async () => {
      const tail = { current: Promise.resolve() }
      let durableRevision = 4
      const writes: number[] = []
      const revisionCheckpoint = serializeAsync(tail, async () => {
        throw new Error('revision checkpoint failed')
      })
      const delayedAutosave = serializeAsync(tail, async () => {
        const snapshotRevision = 5
        if (!isObjectiveRevisionDurable(snapshotRevision, durableRevision)) return
        writes.push(snapshotRevision)
        durableRevision = snapshotRevision
      })

      await expect(revisionCheckpoint).rejects.toThrow('revision checkpoint failed')
      await delayedAutosave

      expect(writes).toEqual([])
      expect(durableRevision).toBe(4)
    })

    it('does not persist a failed first revision when no durable goal exists yet', async () => {
      const tail = { current: Promise.resolve() }
      const writes: number[] = []
      const revisionCheckpoint = serializeAsync(tail, async () => {
        throw new Error('revision checkpoint failed')
      })
      const delayedAutosave = serializeAsync(tail, async () => {
        const snapshotRevision = 1
        if (!isObjectiveRevisionDurable(snapshotRevision, undefined)) return
        writes.push(snapshotRevision)
      })

      await expect(revisionCheckpoint).rejects.toThrow('revision checkpoint failed')
      await delayedAutosave

      expect(writes).toEqual([])
    })
  })

  describe('objective revision guard', () => {
    it('skips a stale worktree-confirmation continuation and dispatches the newer revision', async () => {
      const confirmation = deferred<boolean>()
      let epoch = 1
      const dispatched: string[] = []
      let staleCount = 0
      const oldRevision = runWithObjectiveRevisionGuard(
        1,
        () => epoch,
        async isCurrent => {
          const approved = await confirmation.promise
          if (!isCurrent()) return { approved }
          return { approved }
        },
        async (_prepared, isCurrent) => {
          if (!isCurrent()) return false
          dispatched.push('revision 1')
        },
        () => { staleCount++ },
      )

      await Promise.resolve()
      epoch = 2
      confirmation.resolve(true)
      expect(await oldRevision).toBe(false)
      expect(dispatched).toEqual([])
      expect(staleCount).toBe(1)

      const currentRevision = await runWithObjectiveRevisionGuard(
        2,
        () => epoch,
        async () => ({ prepared: true }),
        async (_prepared, isCurrent) => {
          if (!isCurrent()) return false
          dispatched.push('revision 2')
        },
        () => { staleCount++ },
      )

      expect(currentRevision).toBe(true)
      expect(dispatched).toEqual(['revision 2'])
      expect(staleCount).toBe(1)
    })
  })

  describe('/revise parsing', () => {
    it('accepts only the explicit command and preserves the objective text', () => {
      expect(getObjectiveRevision('/revise   Replace the current objective')).toBe('Replace the current objective')
      expect(getObjectiveRevision('/REVISE keep this case-insensitive')).toBe('keep this case-insensitive')
      expect(getObjectiveRevision('Please revise the objective')).toBeNull()
      expect(getObjectiveRevision('/revise-extra objective')).toBeNull()
    })

    it('returns an empty objective for the usage error path', () => {
      expect(getObjectiveRevision('/revise')).toBe('')
      expect(getObjectiveRevision('/revise   ')).toBe('')
    })
  })

  describe('/steer parsing', () => {
    it('accepts only the explicit command and preserves the instruction text', () => {
      expect(getSteerInstruction('/steer   Focus on the failing integration')).toBe('Focus on the failing integration')
      expect(getSteerInstruction('/STEER keep this case-insensitive')).toBe('keep this case-insensitive')
      expect(getSteerInstruction('Please steer the conversation')).toBeNull()
      expect(getSteerInstruction('/steer-extra instruction')).toBeNull()
    })

    it('returns an empty instruction for the usage error path', () => {
      expect(getSteerInstruction('/steer')).toBe('')
      expect(getSteerInstruction('/steer   ')).toBe('')
    })
  })
})
