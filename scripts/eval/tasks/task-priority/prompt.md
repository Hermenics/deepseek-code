Add task priorities to this project:

- A task has a `priority` of `'low' | 'normal' | 'high'`. `TaskStore.add(title, priority?)` defaults to `'normal'`.
- `TaskStore.list()` returns high-priority tasks first, then normal, then low, keeping insertion order among tasks with the same priority.
- `formatTask` prefixes high-priority tasks with `! `, for example `! [ ] Pay rent`. Other tasks are formatted as before.

Keep the existing tests passing and add tests for the new behavior.
