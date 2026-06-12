import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";

let audioModeReady = false;

async function ensureAudioMode(): Promise<void> {
  if (audioModeReady) return;
  audioModeReady = true;
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
  } catch {}
}

let counter = 0;
let activeStop: (() => void) | null = null;

export function stopActiveCue(): void {
  if (activeStop) activeStop();
}

export async function playCueMp3Base64(base64: string): Promise<void> {
  await ensureAudioMode();
  const path = `${FileSystem.cacheDirectory}cue-${Date.now()}-${counter++}.mp3`;
  await FileSystem.writeAsStringAsync(path, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const player = createAudioPlayer({ uri: path });
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    if (activeStop === stop) activeStop = null;
    try {
      player.remove();
    } catch {}
    FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  };
  const stop = () => {
    try {
      player.pause();
    } catch {}
    sub.remove();
    cleanup();
  };

  const sub = player.addListener("playbackStatusUpdate", (status) => {
    if (status.didJustFinish) {
      sub.remove();
      cleanup();
    }
  });

  activeStop = stop;
  player.play();
}
