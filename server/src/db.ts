import { Client, Pool, type PoolClient } from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config } from "./config.js";
const pool = new Pool({ connectionString: config.databaseUrl });
export const USER_EVENT_CHANNEL = "syncbook_user_events";
let userEventClient: Client | null = null;
let userEventHandler: ((userId: string, type: string) => void) | null = null;
export async function query<T extends Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, values);
  return result.rows;
}
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function notifyUserEvent(userId: string, type: string): Promise<void> {
  await query("SELECT pg_notify($1, $2)", [
    USER_EVENT_CHANNEL,
    JSON.stringify({ userId, type }),
  ]);
}

export async function subscribeUserEvents(
  handler: (userId: string, type: string) => void,
): Promise<void> {
  userEventHandler = handler;
  if (userEventClient) {
    return;
  }
  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();
  await client.query(`LISTEN ${USER_EVENT_CHANNEL}`);
  client.on("notification", (message) => {
    if (!message.payload) {
      return;
    }
    const event = JSON.parse(message.payload) as { userId?: string; type?: string };
    if (event.userId && event.type && userEventHandler) {
      userEventHandler(event.userId, event.type);
    }
  });
  userEventClient = client;
}
export async function migrate(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(resolve(here, "../sql/001_init.sql"), "utf8");
  await pool.query(sql);
}
export { pool };
