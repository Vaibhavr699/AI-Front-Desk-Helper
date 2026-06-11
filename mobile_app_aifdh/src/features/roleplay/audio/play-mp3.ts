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

export async function playMp3Base64(base64: string): Promise<void> {
  await ensureAudioMode();
  const path = `${FileSystem.cacheDirectory}roleplay-${Date.now()}-${counter++}.mp3`;
  await FileSystem.writeAsStringAsync(path, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const player = createAudioPlayer({ uri: path });
  const cleanup = () => {
    try {
      player.remove();
    } catch {}
    FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  };

  const sub = player.addListener("playbackStatusUpdate", (status) => {
    if (status.didJustFinish) {
      sub.remove();
      cleanup();
    }
  });

  player.play();
}
