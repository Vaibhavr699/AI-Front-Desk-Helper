import * as SQLite from "expo-sqlite";

import type { PendingRecording, PendingStatus } from "./types";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("rep-coach-offline.db").then(
      async (db) => {
        await db.execAsync(`
          PRAGMA journal_mode = WAL;
          CREATE TABLE IF NOT EXISTS pending_recordings (
            id TEXT PRIMARY KEY NOT NULL,
            lead_id TEXT NOT NULL,
            lead_name TEXT,
            file_uri TEXT NOT NULL,
            consent_status TEXT NOT NULL,
            consent_method TEXT NOT NULL,
            consent_state TEXT,
            duration_seconds INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT
          );
        `);
        return db;
      },
    );
  }
  return dbPromise;
}

export async function insertPending(row: PendingRecording): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO pending_recordings
       (id, lead_id, lead_name, file_uri, consent_status, consent_method,
        consent_state, duration_seconds, created_at, status, attempts, last_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.lead_id,
      row.lead_name,
      row.file_uri,
      row.consent_status,
      row.consent_method,
      row.consent_state,
      row.duration_seconds,
      row.created_at,
      row.status,
      row.attempts,
      row.last_error,
    ],
  );
}

export async function listPending(): Promise<PendingRecording[]> {
  const db = await getDb();
  return db.getAllAsync<PendingRecording>(
    `SELECT * FROM pending_recordings ORDER BY created_at ASC`,
  );
}

export async function deletePending(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM pending_recordings WHERE id = ?`, [id]);
}

export async function updatePendingStatus(
  id: string,
  status: PendingStatus,
  opts: { attempts?: number; lastError?: string | null } = {},
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE pending_recordings
        SET status = ?,
            attempts = COALESCE(?, attempts),
            last_error = ?
      WHERE id = ?`,
    [status, opts.attempts ?? null, opts.lastError ?? null, id],
  );
}

export async function totalBufferedSeconds(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(duration_seconds) AS total FROM pending_recordings`,
  );
  return row?.total ?? 0;
}

export async function resetStuckUploading(): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE pending_recordings SET status = 'pending' WHERE status = 'uploading'`,
  );
}
