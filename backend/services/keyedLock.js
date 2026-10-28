export function createKeyedLock() {
  const tails = new Map();
  return async function withKeyedLock(key, task) {
    const previous = tails.get(key) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    const queued = previous.then(() => current);
    tails.set(key, queued);
    await previous;
    try { return await task(); }
    finally { release(); if (tails.get(key) === queued) tails.delete(key); }
  };
}
