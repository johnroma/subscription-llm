export class CapacityError extends Error {
  constructor(message = "Service capacity full") {
    super(message)
    this.name = "CapacityError"
  }
}

export class ConcurrencyGate {
  private active = 0
  private queue: Array<() => void> = []

  constructor(private maxConcurrent: number) {}

  get inUse(): number {
    return this.active
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }

    this.active++

    try {
      return await fn()
    } finally {
      this.active--
      const next = this.queue.shift()
      if (next) next()
    }
  }
}
