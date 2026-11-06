// Types for the one Node.js module the Worker uses. Workers provide it with the nodejs_compat flag.
declare module "node:async_hooks" {
  export class AsyncLocalStorage<T> {
    getStore(): T | undefined;
    run<R>(store: T, fn: () => R): R;
  }
}
