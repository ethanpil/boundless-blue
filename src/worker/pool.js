// A few world-building workers (world.worker.js). Jobs wait in a queue here and go to a free worker one at a
// time, so cancel() can drop jobs that have not started. Each job is a handle { done, result, error, promise }:
// promise resolves (never rejects) once the job settles; result is null when it failed or was cancelled, and
// the caller then builds on the main thread. If a worker cannot start (no module workers, a load error), the
// pool marks itself failed and settles everything, so callers fall back for good.
export class WorkerPool {
  // null where workers are unavailable (Node tools, old browsers). The default leaves a core each to the main
  // thread and the GPU process: on a 4-thread CPU two workers rebuilt a zone faster than three (or one).
  static create(n = Math.max(1, Math.min(3, (globalThis.navigator?.hardwareConcurrency || 2) - 2))) {
    if (typeof Worker === 'undefined') return null;
    try { return new WorkerPool(n); } catch (e) { console.warn('world workers unavailable:', e.message); return null; }
  }
  constructor(n) {
    this.queue = []; this.failed = false; this.nextId = 1;
    this.lastProgress = 0; // when a job last went out or came back
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./world.worker.js', import.meta.url), { type: 'module' });
      w.job = null;
      w.onmessage = (e) => this._done(w, e.data);
      w.onerror = (e) => { e.preventDefault(); this._fail(e.message || 'worker error'); };
      this.workers.push(w);
    }
  }
  run(msg) {
    const job = { msg, done: false, result: null, error: null };
    job.promise = new Promise((r) => { job.resolve = r; });
    if (this.failed) this._settle(job, null, 'workers failed');
    else { this.queue.push(job); this._pump(); }
    return job;
  }
  // Jobs are out but none went out or came back for `ms`: a caller running a synchronous loop (no worker
  // message can arrive until it returns) or workers that stopped answering. Callers then build on the main thread.
  stalled(ms) { return this.workers.some((w) => w.job) && performance.now() - this.lastProgress > ms; }
  // Drop a job that has not started; one already running finishes and its result is discarded.
  cancel(job) {
    if (job.done) return;
    const i = this.queue.indexOf(job);
    if (i >= 0) this.queue.splice(i, 1);
    this._settle(job, null, 'cancelled');
  }
  _pump() {
    for (const w of this.workers) {
      if (w.job || !this.queue.length) continue;
      const job = w.job = this.queue.shift();
      job.msg.id = this.nextId++;
      w.postMessage(job.msg);
      this.lastProgress = performance.now();
    }
  }
  _done(w, d) {
    const job = w.job;
    w.job = null;
    this.lastProgress = performance.now();
    if (job && d.id === job.msg.id) {
      if (d.error) console.warn('world worker job failed, building on the main thread:', d.error);
      this._settle(job, d.error ? null : d.result, d.error || null);
    }
    this._pump();
  }
  _fail(msg) {
    if (this.failed) return;
    this.failed = true;
    console.warn('world workers failed, building on the main thread:', msg);
    for (const w of this.workers) { if (w.job) this._settle(w.job, null, msg); w.terminate(); }
    for (const job of this.queue) this._settle(job, null, msg);
    this.queue.length = 0;
  }
  _settle(job, result, error) {
    if (job.done) return;
    job.done = true; job.result = result; job.error = error;
    job.resolve();
  }
}
