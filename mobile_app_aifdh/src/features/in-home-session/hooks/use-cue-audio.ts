import { useCallback, useState } from "react";

import { playCueMp3Base64 } from "../audio/cue-audio-player";
import { useAudioOutputReady } from "../audio/audio-route";

export function useCueAudio() {
  const [muted, setMuted] = useState(false);
  const ready = useAudioOutputReady();

  const play = useCallback(
    (base64: string): boolean => {
      if (muted || !ready) return false;
      playCueMp3Base64(base64).catch(() => {});
      return true;
    },
    [muted, ready],
  );

  return { play, muted, setMuted, ready };
}
