import React, { createContext, useContext, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, AlertCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'success', duration = 4000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      removeToast(id);
    }, duration);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const success = (msg, dur) => addToast(msg, 'success', dur);
  const error = (msg, dur) => addToast(msg, 'error', dur);
  const info = (msg, dur) => addToast(msg, 'info', dur);
  const warning = (msg, dur) => addToast(msg, 'warning', dur);

  return (
    <ToastContext.Provider value={{ success, error, info, warning }}>
      {children}
      <div className="fixed top-20 right-6 z-[9999] flex flex-col gap-3 pointer-events-none w-full max-w-[320px]">
        <AnimatePresence mode="popLayout">
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onRemove={() => removeToast(toast.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

const ToastItem = ({ toast, onRemove }) => {
  const icons = {
    success: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
    error: <XCircle className="w-4 h-4 text-rose-500" />,
    warning: <AlertCircle className="w-4 h-4 text-amber-500" />,
    info: <Info className="w-4 h-4 text-blue-500" />
  };

  const borderColors = {
    success: 'border-emerald-500/20 border-t-emerald-500',
    error: 'border-rose-500/20 border-t-rose-500',
    warning: 'border-amber-500/20 border-t-amber-500',
    info: 'border-blue-500/20 border-t-blue-500'
  };

  const bgColors = {
    success: 'bg-emerald-600 text-white shadow-emerald-500/20',
    error: 'bg-rose-600 text-white shadow-rose-500/20',
    warning: 'bg-amber-500 text-white shadow-amber-500/20',
    info: 'bg-blue-600 text-white shadow-blue-500/20'
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -20, x: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border-2 border-t-4 shadow-xl backdrop-blur-md transition-all duration-300 ${bgColors[toast.type]} ${borderColors[toast.type]} min-w-[280px]`}
    >
      <div className="mt-0.5">
        {React.cloneElement(icons[toast.type], { className: "w-5 h-5 text-white" })}
      </div>
      <div className="flex-1 mr-2">
        <p className="text-[10px] font-black uppercase tracking-widest opacity-80 leading-tight">
          {toast.type}
        </p>
        <p className="text-[13px] font-bold mt-0.5 leading-snug">
          {toast.message}
        </p>
      </div>
      <button 
        onClick={onRemove}
        className="text-white/60 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-lg"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
};
