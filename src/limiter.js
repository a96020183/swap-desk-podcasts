// Spaces out calls to one service: at most `concurrency` in flight and at least `minGapMs` between starts.
export function makeLimiter({ minGapMs = 0, concurrency = 1 } = {}) {
  let active = 0, last = 0, timer = null;
  const queue = [];
  const pump = () => {
    if (timer || !queue.length || active >= concurrency) return;
    const wait = Math.max(0, last + minGapMs - Date.now());
    if (wait > 0) { timer = setTimeout(() => { timer = null; pump(); }, wait); return; }
    const { fn, resolve, reject } = queue.shift();
    active++; last = Date.now();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; pump(); });
    pump();
  };
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump(); });
}
