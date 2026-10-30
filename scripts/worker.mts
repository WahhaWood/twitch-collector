// Watch worker: `npm run worker`. Runs until stopped (Ctrl+C); see src/lib/worker.ts.
import { stopAll, tick, TICK_MS } from "../src/lib/worker";

let running = true;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    running = false;
  });
}

console.log(`watch worker started, tick ${TICK_MS / 1000} s`);
while (running) {
  const started = Date.now();
  await tick(started).catch((e) => console.error("tick failed:", e instanceof Error ? e.message : "unknown"));
  const wait = TICK_MS - (Date.now() - started);
  for (let t = 0; running && t < wait; t += 500) await new Promise((r) => setTimeout(r, 500));
}
await stopAll();
console.log("watch worker stopped");
