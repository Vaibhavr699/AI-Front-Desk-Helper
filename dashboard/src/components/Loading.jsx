<<<<<<< HEAD
import { LumaSpin } from "./ui/luma-spin";

export default function Loading({ fullScreen = true, message = "Loading…" }) {
    const content = (
        <div className="flex flex-col items-center justify-center space-y-4">
            <LumaSpin />
            {message && <p className="text-sm font-medium text-stone-500">{message}</p>}
        </div>
    );

    if (fullScreen) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-50/80 backdrop-blur-sm">
                {content}
            </div>
        );
    }

    return <div className="flex w-full items-center justify-center p-8">{content}</div>;
=======
export default function Loading({ fullScreen = true, message = "Loading…" }) {
  const content = (
    <div className="flex flex-col items-center justify-center gap-6">
      <div className="relative flex items-center justify-center w-14 h-14">
        {/* Logo mark */}
        <span
          className="flex items-center justify-center w-11 h-11 rounded-xl bg-stone-800 text-white text-base font-bold shadow-lg z-10"
          aria-hidden
        >
          FD
        </span>
        
      </div>
      <div className="flex flex-col items-center gap-3">
        <div className="h-1.5 w-28 rounded-full bg-stone-200 overflow-hidden">
          <div
            className="h-full rounded-full bg-stone-600 animate-pulse"
            style={{ width: "45%" }}
            aria-hidden
          />
        </div>
        <p className="text-sm font-medium text-stone-500">{message}</p>
      </div>
    </div>
  );

  if (fullScreen) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-stone-100/95 backdrop-blur-sm"
        role="status"
        aria-live="polite"
        aria-label={message}
      >
        {content}
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-center py-12 sm:py-16"
      role="status"
      aria-live="polite"
      aria-label={message}
    >
      {content}
    </div>
  );
>>>>>>> 27d1bf5 (Twilio testing)
}
