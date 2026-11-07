import { createConnection, createServer, type Server, type Socket } from "node:net";

/**
 * A TCP proxy between the app and Postgres that does two jobs without touching app
 * code: it adds the round-trip time a real database has, and it reads the wire
 * protocol enough to say what each interaction asked the database.
 *
 * A local Postgres answers in microseconds, so without this a page that runs 30
 * queries in series looks as fast as one that runs 1.
 */
export type QueryRecord = { sql: string; ms: number; at: number };

type Pending = { sql: string; startedAt: number };

export type DbProxy = {
  port: number;
  /** Everything finished since the last call. */
  drain(): QueryRecord[];
  close(): Promise<void>;
};

/** The frontend messages that carry SQL or end a round trip. */
function readFrontend(state: { buffer: Buffer; started: boolean; sql: string }, chunk: Buffer, onSync: (sql: string) => void) {
  state.buffer = Buffer.concat([state.buffer, chunk]);
  for (;;) {
    if (!state.started) {
      // The startup packet has a length and no type byte.
      if (state.buffer.length < 4) return;
      const length = state.buffer.readInt32BE(0);
      if (state.buffer.length < length) return;
      state.buffer = state.buffer.subarray(length);
      state.started = true;
      continue;
    }
    if (state.buffer.length < 5) return;
    const type = String.fromCharCode(state.buffer[0]);
    const length = state.buffer.readInt32BE(1);
    if (state.buffer.length < length + 1) return;
    const body = state.buffer.subarray(5, length + 1);
    if (type === "P") {
      const nameEnd = body.indexOf(0);
      const sqlEnd = body.indexOf(0, nameEnd + 1);
      state.sql = body.subarray(nameEnd + 1, sqlEnd).toString("utf8");
    } else if (type === "Q") {
      onSync(body.subarray(0, Math.max(0, body.length - 1)).toString("utf8"));
    } else if (type === "S") {
      onSync(state.sql);
      state.sql = "";
    }
    state.buffer = state.buffer.subarray(length + 1);
  }
}

/** Counts ReadyForQuery ('Z'), which closes one round trip. */
function readBackend(state: { buffer: Buffer }, chunk: Buffer, onReady: () => void) {
  state.buffer = Buffer.concat([state.buffer, chunk]);
  for (;;) {
    if (state.buffer.length < 5) return;
    const type = String.fromCharCode(state.buffer[0]);
    const length = state.buffer.readInt32BE(1);
    if (state.buffer.length < length + 1) return;
    if (type === "Z") onReady();
    state.buffer = state.buffer.subarray(length + 1);
  }
}

export async function startDbProxy(input: { targetPort: number; roundTripMs: number }): Promise<DbProxy> {
  const oneWay = input.roundTripMs / 2;
  let finished: QueryRecord[] = [];
  const sockets = new Set<Socket>();

  const server: Server = createServer((client) => {
    const upstream = createConnection({ host: "127.0.0.1", port: input.targetPort });
    sockets.add(client);
    sockets.add(upstream);
    const queue: Pending[] = [];
    const front = { buffer: Buffer.alloc(0), started: false, sql: "" };
    const back = { buffer: Buffer.alloc(0) };

    client.on("data", (chunk) => {
      readFrontend(front, chunk, (sql) => queue.push({ sql, startedAt: performance.now() }));
      setTimeout(() => { if (!upstream.destroyed) upstream.write(chunk); }, oneWay);
    });
    upstream.on("data", (chunk) => {
      setTimeout(() => {
        // The record closes when the app would actually have the answer.
        readBackend(back, chunk, () => {
          const pending = queue.shift();
          if (pending) finished.push({ sql: pending.sql, ms: performance.now() - pending.startedAt, at: Date.now() });
        });
        if (!client.destroyed) client.write(chunk);
      }, oneWay);
    });
    const closeBoth = () => { client.destroy(); upstream.destroy(); sockets.delete(client); sockets.delete(upstream); };
    client.on("close", closeBoth);
    upstream.on("close", closeBoth);
    client.on("error", closeBoth);
    upstream.on("error", closeBoth);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The database proxy has no port");
  return {
    port: address.port,
    drain() {
      const out = finished;
      finished = [];
      return out;
    },
    close: () => new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}
