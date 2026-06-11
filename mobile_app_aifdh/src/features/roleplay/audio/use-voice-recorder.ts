import { Audio } from "expo-av";
import { useCallback, useEffect, useRef, useState } from "react";

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: false,
  android: {
    extension: ".m4a",
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 128000,
  },
  ios: {
    extension: ".m4a",
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 128000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 128000,
  },
};

export function useVoiceRecorder() {
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);

  useEffect(() => {
    Audio.requestPermissionsAsync().then(({ granted }) =>
      setPermissionGranted(granted),
    );
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (!permissionGranted) {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) return false;
      setPermissionGranted(true);
    }
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
    const rec = new Audio.Recording();
    await rec.prepareToRecordAsync(RECORDING_OPTIONS);
    await rec.startAsync();
    recordingRef.current = rec;
    setIsRecording(true);
    return true;
  }, [permissionGranted]);

  const stop = useCallback(async (): Promise<string | null> => {
    const rec = recordingRef.current;
    if (!rec) return null;
    recordingRef.current = null;
    setIsRecording(false);
    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      return rec.getURI();
    } catch {
      return null;
    }
  }, []);

  return { permissionGranted, isRecording, start, stop };
}
