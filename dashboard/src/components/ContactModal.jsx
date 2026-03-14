import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Phone, User, Mail, Clock, Send, CheckCircle2, MessageSquare } from "lucide-react";

export function ContactModal({ isOpen, onClose }) {
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    enquiry: "",
    bestTime: "",
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  // Prevent scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
      const res = await fetch(`${apiBase}/api/public/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit");

      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
        setFormData({ name: "", phone: "", email: "", enquiry: "", bestTime: "" });
      }, 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="bg-stone-900 p-8 text-white relative">
              <button
                onClick={onClose}
                className="absolute top-6 right-6 p-2 hover:bg-white/10 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
              <h2 className="text-3xl font-black tracking-tight mb-2">Get in touch</h2>
              <p className="text-stone-400 font-medium">
                Tell us what you need and we'll get back to you.
              </p>
            </div>

            <div className="p-8">
              {success ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="py-12 text-center"
                >
                  <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle2 size={40} />
                  </div>
                  <h3 className="text-2xl font-black text-stone-900 mb-2">Message sent!</h3>
                  <p className="text-stone-500">
                    Thanks for getting in touch. We'll reach out soon about your enquiry.
                  </p>
                </motion.div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-stone-400 ml-1">Full Name</label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                        <input
                          required
                          type="text"
                          placeholder="John Smith"
                          className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900 focus:border-transparent transition-all outline-none text-stone-900 font-medium"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-stone-400 ml-1">Phone Number</label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                        <input
                          required
                          type="tel"
                          placeholder="(512) 555-0199"
                          className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900 focus:border-transparent transition-all outline-none text-stone-900 font-medium"
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-stone-400 ml-1">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                      <input
                        required
                        type="email"
                        placeholder="john@example.com"
                        className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900 focus:border-transparent transition-all outline-none text-stone-900 font-medium"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-stone-400 ml-1">What do you need?</label>
                    <div className="relative">
                      <MessageSquare className="absolute left-3 top-3.5 text-stone-400" size={18} />
                      <textarea
                        required
                        rows={3}
                        placeholder="e.g. Interior painting, exterior quote, deck staining..."
                        className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900 focus:border-transparent transition-all outline-none text-stone-900 font-medium resize-none"
                        value={formData.enquiry}
                        onChange={(e) => setFormData({ ...formData, enquiry: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-stone-400 ml-1">Best time to reach you</label>
                    <div className="relative">
                      <Clock className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                      <input
                        type="text"
                        placeholder="e.g. Mornings, after 3 PM"
                        className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900 focus:border-transparent transition-all outline-none text-stone-900 font-medium"
                        value={formData.bestTime}
                        onChange={(e) => setFormData({ ...formData, bestTime: e.target.value })}
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold border border-red-100">
                      {error}
                    </div>
                  )}

                  <button
                    disabled={loading}
                    type="submit"
                    className="w-full py-4 bg-stone-900 text-white rounded-2xl font-black text-lg shadow-xl shadow-stone-200 hover:bg-black transition-all disabled:opacity-50 flex items-center justify-center gap-3 mt-6"
                  >
                    {loading ? (
                      <span className="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        Send enquiry <Send size={20} />
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, document.body);
}
