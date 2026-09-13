export interface User {
  id: string
  name: string
}

export type Fetcher = (id: string) => Promise<User>

export class UserCache {
  private cache = new Map<string, User>()

  constructor(private fetchUser: Fetcher) {}

  async get(id: string): Promise<User> {
    const cached = this.cache.get(id)
    if (cached) return cached
    const user = await this.fetchUser(id)
    this.cache.set(id, user)
    return user
  }
}
