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
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-stone-50/80 backdrop-blur-md pointer-events-auto">
        {content}
      </div>
    );
  }

  return <div className="flex flex-1 w-full min-h-[50vh] items-center justify-center p-8">{content}</div>;
}
