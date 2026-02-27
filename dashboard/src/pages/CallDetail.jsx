import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { getCall, getRecordingAudioUrl } from "../api";
<<<<<<< HEAD
import { LumaSpin } from "../components/ui/luma-spin";
=======
import { Loading } from "../components";
>>>>>>> 27d1bf5 (Twilio testing)

function AudioPlayer({ recordingId }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let url;
    getRecordingAudioUrl(recordingId)
      .then((u) => { url = u; setSrc(u); })
      .catch((e) => setErr(e.message));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [recordingId]);
  if (err) return <p className="text-sm text-red-600">Audio: {err}</p>;
  if (!src) return <p className="text-sm text-stone-500">Loading audio…</p>;
  return <audio controls src={src} className="w-full max-w-md h-10 rounded-lg" />;
}

export default function CallDetail() {
  const { id } = useParams();
  const [call, setCall] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getCall(id).then(setCall).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [id]);

<<<<<<< HEAD
  if (loading) return <div className="px-0 flex items-center justify-center py-20"><LumaSpin /></div>;
=======
  if (loading) return <div className="px-0"><Loading fullScreen={false} message="Loading call…" /></div>;
>>>>>>> 27d1bf5 (Twilio testing)
  if (error) return <div className="px-0"><p className="text-red-600 text-sm">{error}</p></div>;
  if (!call) return null;

  const recordings = call.recordings || [];
  const primaryRec = recordings.find((r) => r.transcript) || recordings[0];

  return (
    <div className="px-0 max-w-3xl">
      <p className="mb-4">
        <Link to="/calls" className="text-sm font-medium text-stone-600 hover:text-stone-900">← Back to calls</Link>
      </p>
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="px-4 py-4 sm:px-6 sm:py-5 border-b border-stone-200">
          <h1 className="text-lg sm:text-xl font-semibold text-stone-900">Call from {call.from_number || "Unknown"}</h1>
          <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 text-sm">
            <div><dt className="text-stone-500">Time</dt><dd className="text-stone-900">{new Date(call.started_at).toLocaleString()}</dd></div>
            <div><dt className="text-stone-500">Status</dt><dd className="text-stone-900">{call.status}</dd></div>
            <div><dt className="text-stone-500">Disposition</dt><dd className="text-stone-900">{call.transferred ? "Transferred" : call.disposition || "—"}</dd></div>
          </dl>
        </div>
        {primaryRec && (
          <div className="px-4 py-4 sm:px-6 sm:py-5 border-b border-stone-200">
            <h2 className="text-sm font-medium text-stone-700 mb-2">Recording</h2>
            <AudioPlayer recordingId={primaryRec.id} />
          </div>
        )}
        {primaryRec?.transcript && (
          <div className="px-4 py-4 sm:px-6 sm:py-5">
            <h2 className="text-sm font-medium text-stone-700 mb-2">Transcript</h2>
            <div className="text-sm text-stone-600 whitespace-pre-wrap bg-stone-50 rounded-lg p-4">{primaryRec.transcript}</div>
          </div>
        )}
        {recordings.length === 0 && <div className="px-4 py-4 sm:px-6 sm:py-5"><p className="text-sm text-stone-500">No recording yet.</p></div>}
      </div>
    </div>
  );
}
