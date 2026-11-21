// Small stand-ins for cloudflare:workers, enough to load the Worker in Node.
export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}
export class WorkerEntrypoint {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}
export class RpcTarget {}
export const env = {};
