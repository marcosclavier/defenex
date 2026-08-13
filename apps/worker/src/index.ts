import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 3001);

/**
 * Railway health check target. Kept deliberately dumb: it reports that the
 * process is alive, not that downstream services are reachable — a health check
 * that fails on a transient Postgres blip causes restart loops.
 */
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, () => {
  console.log(JSON.stringify({ msg: "worker listening", port: PORT }));
});

/**
 * Railway sends SIGTERM on redeploy. Stop accepting new work, let in-flight
 * jobs drain, then exit — otherwise a deploy silently kills running scans.
 */
async function shutdown(signal: string) {
  console.log(JSON.stringify({ msg: "shutting down", signal }));
  server.close();
  // Queue workers registered in Stage 3 close here before exit.
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
