/** One read batch at a time; mutations during a read schedule a trailing fresh batch. */
export class CoalescedRefresh<Key extends string> {
  private readonly pending = new Set<Key>();
  private running: Promise<void> | null = null;
  public constructor(private readonly load: (keys: readonly Key[]) => Promise<void>) {}
  public request(keys: readonly Key[]): Promise<void> {
    keys.forEach((key) => this.pending.add(key));
    this.running ??= this.drain();
    return this.running;
  }
  private async drain(): Promise<void> {
    // Collect requests from the same microtask before issuing network reads.
    await Promise.resolve();
    try {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        await this.load(keys);
      }
    } finally {
      this.running = null;
    }
  }
}
