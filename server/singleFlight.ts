export class SingleFlight<Key, Value> {
  readonly #pending = new Map<Key, Promise<Value>>();

  async #create(key: Key, create: () => Promise<Value>): Promise<Value> {
    try {
      return await create();
    } finally {
      this.#pending.delete(key);
    }
  }

  run(key: Key, create: () => Promise<Value>): Promise<Value> {
    const existing = this.#pending.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const pending = this.#create(key, create);
    this.#pending.set(key, pending);
    return pending;
  }
}
