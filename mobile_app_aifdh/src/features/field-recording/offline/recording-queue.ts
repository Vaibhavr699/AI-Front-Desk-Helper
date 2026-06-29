import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";

import {
  deletePending,
  insertPending,
  listPending,
  totalBufferedSeconds,
} from "./queue-db";
import { MAX_BUFFER_SECONDS, type EnqueueInput, type PendingRecording } from "./types";

const DIR = `${FileSystem.documentDirectory}pending-recordings/`;

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  }
}

async function persistFile(srcUri: string, id: string): Promise<string> {
  await ensureDir();
  const dest = `${DIR}${id}.m4a`;
  await FileSystem.moveAsync({ from: srcUri, to: dest });
  return dest;
}

export async function deleteFile(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {}
}

export type EnqueueResult =
  | { ok: true; recording: PendingRecording }
  | { ok: false; reason: "buffer_full"; bufferedSeconds: number };

export async function enqueueRecording(
  input: EnqueueInput,
): Promise<EnqueueResult> {
  const buffered = await totalBufferedSeconds();
  if (buffered + input.durationSeconds > MAX_BUFFER_SECONDS) {
    return { ok: false, reason: "buffer_full", bufferedSeconds: buffered };
  }

  const id = Crypto.randomUUID();
  const fileUri = await persistFile(input.fileUri, id);

  const recording: PendingRecording = {
    id,
    lead_id: input.leadId,
    lead_name: input.leadName ?? null,
    file_uri: fileUri,
    consent_status: input.consentStatus,
    consent_method: input.consentMethod,
    consent_state: input.consentState,
    duration_seconds: input.durationSeconds,
    created_at: Date.now(),
    status: "pending",
    attempts: 0,
    last_error: null,
  };

  await insertPending(recording);
  return { ok: true, recording };
}

export async function getPending(): Promise<PendingRecording[]> {
  return listPending();
}

export async function removePending(rec: PendingRecording): Promise<void> {
  await deleteFile(rec.file_uri);
  await deletePending(rec.id);
}
