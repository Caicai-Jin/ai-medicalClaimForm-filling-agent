// The AI SDK executes all tool calls within a single step via Promise.all, but Playwright actions
// on one shared Page aren't safe to run concurrently. FormFiller uses this to serialize them to
// the call order the model produced them in, regardless of how the SDK schedules the underlying
// promises.
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.then(
      () => {},
      () => {}
    );
    return result;
  }
}
