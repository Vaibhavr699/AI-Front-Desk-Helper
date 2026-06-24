import { useState, useRef, useEffect } from "react";
import { Mic, Square, Play, Pause, RefreshCw, Trash2, Check, AlertCircle } from "lucide-react";

/**
 * VoicemailGreetingRecorder (Phase 3A, Jun 2026)
 *
 * In-browser recorder for a tenant's outgoing voicemail greeting. Records mic
 * audio, encodes it to 16-bit PCM WAV CLIENT-SIDE (Twilio <Play> needs MP3/WAV;
 * the browser's MediaRecorder only gives WebM/Opus, so we capture raw PCM via
 * the Web Audio API and write the WAV header ourselves — no server transcode).
 * Uploads to /api/voicemail-greeting/upload and hands the public URL back via
 * onSaved, which the parent drops into the existing voicemail_message_url field.
 *
 * Props:
 *   tenantId   — string, required
 *   currentUrl — string, the currently-saved greeting URL (may be a pasted CDN
 *                link or a previously-recorded one); shown as "current greeting"
 *   apiBase    — backend base URL (import.meta.env.VITE_API_URL in the parent)
 *   onSaved    — (url) => void, called after a successful upload
 *   onToast    — (message, type) => void, optional, for success/error toasts
 *
 * The recorder NEVER auto-saves the tenant — onSaved just fills the form field.
 * The tenant still clicks the page's Save to persist, matching every other
 * field on the tab.
 */

const MAX_SECONDS = 120; // hard cap; matches the backend size guard
const TARGET_SAMPLE_RATE = 16000; // 16kHz mono — small, clear for voice, Twilio-friendly

function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// Downsample a Float32 buffer from the AudioContext's native rate to 16kHz.
function downsample(buffer, fromRate, toRate) {
  if (toRate >= fromRate) return buffer;
  const ratio = fromRate / toRate;
  const newLen = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLen);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < newLen) {
    const nextOffset = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffset && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffset;
  }
  return result;
}

function encodeWav(samples, sampleRate) {
  const pcm = floatTo16BitPCM(samples);
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);     // PCM chunk size
  view.setUint16(20, 1, true);      // audio format = PCM
  view.setUint16(22, 1, true);      // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);      // block align
  view.setUint16(34, 16, true);     // bits per sample
  writeStr(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  let off = 44;
  for (let i = 0; i < pcm.length; i++, off += 2) view.setInt16(off, pcm[i], true);
  return new Blob([view], { type: "audio/wav" });
}

export default function VoicemailGreetingRecorder({ tenantId, currentUrl, apiBase, onSaved, onToast }) {
  const [status, setStatus] = useState("idle"); // idle | recording | recorded | uploading | error
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);

  const mediaStreamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const chunksRef = useRef([]);
  const nativeRateRef = useRef(44100);
  const timerRef = useRef(null);
  const blobRef = useRef(null);
  const audioElRef = useRef(null);

  // Clean up everything on unmount.
  useEffect(() => {
    return () => {
      stopTracksAndNodes();
      if (timerRef.current) clearInterval(timerRef.current);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopTracksAndNodes() {
    try { processorRef.current?.disconnect(); } catch (_) {}
    try { sourceRef.current?.disconnect(); } catch (_) {}
    try { audioCtxRef.current?.close(); } catch (_) {}
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    processorRef.current = null;
    sourceRef.current = null;
    audioCtxRef.current = null;
    mediaStreamRef.current = null;
  }

  async function startRecording() {
    setError("");
    chunksRef.current = [];
    setSeconds(0);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl("");
    }
    blobRef.current = null;

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError("Your browser doesn't support recording. Paste an audio URL instead.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      nativeRateRef.current = ctx.sampleRate;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // ScriptProcessorNode is deprecated but universally supported and fine for
      // a short greeting. Buffer size 4096, mono in/out.
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        // Copy — the underlying buffer is reused by the audio thread.
        chunksRef.current.push(new Float32Array(input));
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      setStatus("recording");

      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) {
            stopRecording();
            return MAX_SECONDS;
          }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      setStatus("error");
      if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        setError("Microphone access was blocked. Allow mic access and try again.");
      } else {
        setError("Couldn't start recording. Check your microphone and try again.");
      }
      stopTracksAndNodes();
    }
  }

  function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const nativeRate = nativeRateRef.current || 44100;

    // Concatenate all captured chunks.
    let total = 0;
    for (const c of chunksRef.current) total += c.length;
    const merged = new Float32Array(total);
    let offset = 0;
    for (const c of chunksRef.current) {
      merged.set(c, offset);
      offset += c.length;
    }

    stopTracksAndNodes();

    if (merged.length === 0) {
      setStatus("idle");
      setError("Nothing was recorded. Try again and speak after pressing record.");
      return;
    }

    const down = downsample(merged, nativeRate, TARGET_SAMPLE_RATE);
    const wav = encodeWav(down, TARGET_SAMPLE_RATE);
    blobRef.current = wav;
    const url = URL.createObjectURL(wav);
    setPreviewUrl(url);
    setStatus("recorded");
  }

  function discardRecording() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    blobRef.current = null;
    setSeconds(0);
    setStatus("idle");
    setError("");
    setIsPlaying(false);
  }

  function togglePlay() {
    const el = audioElRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
    } else {
      el.play().catch(() => {});
    }
  }

  async function uploadRecording() {
    if (!blobRef.current) return;
    if (!tenantId) {
      setError("Missing tenant. Reload the page and try again.");
      return;
    }
    setStatus("uploading");
    setError("");
    try {
      const base = (apiBase || "").replace(/\/+$/, "");
      const resp = await fetch(`${base}/api/voicemail-greeting/upload?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        credentials: "include",
        body: blobRef.current,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok || !data.url) {
        throw new Error(data.error || "Upload failed. Try again.");
      }
      onSaved?.(data.url);
      onToast?.("Greeting recorded. Click Save Changes to apply it.", "success");
      // Keep the local preview so they can still hear what they just saved.
      setStatus("recorded");
    } catch (err) {
      setStatus("recorded");
      setError(err.message || "Upload failed. Try again.");
      onToast?.(err.message || "Upload failed.", "error");
    }
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(1, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white">
            <Mic className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs font-black text-slate-900 uppercase tracking-widest">Record a greeting</p>
            <p className="text-[11px] text-slate-500">Use your mic — no audio file needed.</p>
          </div>
        </div>

        {currentUrl && status === "idle" && (
          <a
            href={currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-black uppercase tracking-widest text-emerald-700 hover:text-emerald-900 underline underline-offset-2"
          >
            Hear current greeting
          </a>
        )}
      </div>

      {/* Idle — start button */}
      {status === "idle" && (
        <button
          type="button"
          onClick={startRecording}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black transition-all"
        >
          <Mic className="w-3.5 h-3.5" />
          Start recording
        </button>
      )}

      {/* Recording — live timer + stop */}
      {status === "recording" && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-black text-red-700 tabular-nums">{mmss}</span>
          </span>
          <button
            type="button"
            onClick={stopRecording}
            className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-red-700 transition-all"
          >
            <Square className="w-3.5 h-3.5" />
            Stop
          </button>
          <span className="text-[11px] text-slate-400 italic">Auto-stops at 2:00</span>
        </div>
      )}

      {/* Recorded — preview, re-record, use it */}
      {(status === "recorded" || status === "uploading") && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={togglePlay}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest text-slate-700 hover:border-slate-300 transition-all"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isPlaying ? "Pause" : "Play back"}
            </button>
            <span className="text-xs font-bold text-slate-500 tabular-nums">{mmss}</span>

            <audio
              ref={audioElRef}
              src={previewUrl}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
              className="hidden"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={uploadRecording}
              disabled={status === "uploading"}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-50"
            >
              {status === "uploading" ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {status === "uploading" ? "Uploading…" : "Use this recording"}
            </button>
            <button
              type="button"
              onClick={discardRecording}
              disabled={status === "uploading"}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:border-slate-300 transition-all disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Re-record
            </button>
          </div>
          <p className="text-[11px] text-slate-400 italic">
            "Use this recording" fills the Audio URL above. Click Save Changes at the top to apply it.
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-800 leading-relaxed">{error}</p>
        </div>
      )}
    </div>
  );
}
