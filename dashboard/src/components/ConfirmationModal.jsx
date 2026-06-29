import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";

export function ConfirmationModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title = "Are you sure?", 
  message = "This action cannot be undone.", 
  confirmText = "Delete", 
  cancelText = "Cancel",
  variant = "danger",
  loading = false
}) {
  const isDanger = variant === "danger";

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0"
          />
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
          >
            <div className={`p-6 flex flex-col items-center text-center ${isDanger ? "bg-red-50/50" : "bg-blue-50/50"}`}>
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${isDanger ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}`}>
                <AlertTriangle size={32} />
              </div>
              <h3 className="text-xl font-black text-stone-900 leading-tight mb-2">
                {title}
              </h3>
              <p className="text-stone-500 font-medium text-sm px-4">
                {message}
              </p>
            </div>

            <div className="p-6 flex gap-3">
              <button
                disabled={loading}
                onClick={onClose}
                className="flex-1 py-3 bg-stone-100 text-stone-600 rounded-xl font-bold hover:bg-stone-200 transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {cancelText}
              </button>
              <button
                disabled={loading}
                onClick={onConfirm}
                className={`flex-1 py-3 text-white rounded-xl font-bold shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center ${
                  isDanger 
                    ? "bg-red-600 shadow-red-100 hover:bg-red-700" 
                    : "bg-stone-900 shadow-stone-100 hover:bg-black"
                }`}
              >
                {loading ? (
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  confirmText
                )}
              </button>
            </div>

            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 text-stone-400 hover:text-stone-900 hover:bg-stone-100 rounded-full transition-all"
            >
              <X size={18} />
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
