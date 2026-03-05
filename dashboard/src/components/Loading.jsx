export default function Loading({ fullScreen = true, message = "Loading…" }) {
    const content = (
        <div className="flex flex-col items-center justify-center space-y-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-stone-200 border-t-brand-600 border-r-brand-600"></div>
            {message && <p className="text-sm font-medium text-stone-600">{message}</p>}
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
}
