import { ResolverError } from "./errors.js";

export class Deadline {
  private readonly startedAt = Date.now();

  constructor(private readonly budgetMs: number) {}

  remainingMs(): number {
    return Math.max(0, this.budgetMs - (Date.now() - this.startedAt));
  }

  throwIfExpired(): void {
    if (this.remainingMs() <= 0) {
      throw new ResolverError(
        "RESOLUTION_TIMEOUT",
        `Resolution exceeded the ${this.budgetMs} ms budget.`,
        true
      );
    }
  }
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  makeError: () => ResolverError
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(makeError()), Math.max(1, timeoutMs));
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}