import { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Eye, EyeClosed, ArrowRight, ArrowLeft, CheckCircle2 } from "lucide-react";
import { resetPassword } from "../api";
import { cn } from "../lib/utils";

function Input({ className, type, ...props }) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-md border text-stone-900 bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-stone-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  );
}

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [focusedInput, setFocusedInput] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!token) {
      setError("Invalid or missing reset token");
      return;
    }

    setError("");
    setIsLoading(true);
    try {
      await resetPassword(token, password);
      setIsSubmitted(true);
      setTimeout(() => navigate("/login"), 3000);
    } catch (err) {
      setError(err.message || "Failed to reset password");
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen w-screen bg-stone-50 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-white rounded-2xl p-8 border border-stone-200 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
            <Lock className="w-6 h-6 text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-stone-900">Invalid Link</h1>
          <p className="text-sm text-stone-500">
            This password reset link is invalid or has expired.
          </p>
          <Link
            to="/forgot-password"
            className="inline-flex items-center gap-2 text-sm font-medium text-stone-900 hover:text-blue-700 transition-colors"
          >
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-screen bg-stone-50 relative overflow-hidden flex items-center justify-center">
      <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-[120vh] h-[60vh] rounded-b-[50%] bg-stone-200/40 blur-[80px]" />
      
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="w-full max-w-sm relative z-10 mx-4"
      >
        <div className="relative group">
          <div className="relative bg-white/90 backdrop-blur-xl rounded-2xl p-6 sm:p-8 border border-stone-200 shadow-sm transition-all duration-300 group-hover:shadow-2xl group-hover:border-stone-300 overflow-hidden">
            
            <div className="text-center space-y-1 mb-8 pt-4 text-stone-900">
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="mx-auto w-12 h-12 rounded-xl bg-gradient-to-br from-stone-900 to-stone-700 text-white flex items-center justify-center shadow-lg"
              >
                <Lock className="w-6 h-6" />
              </motion.div>

              <h1 className="text-2xl font-bold tracking-tight mt-4">
                Reset Password
              </h1>
              <p className="text-stone-500 text-sm">
                Set a new password for your account.
              </p>
            </div>

            <AnimatePresence mode="wait">
              {!isSubmitted ? (
                <motion.form
                  key="form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onSubmit={handleSubmit}
                  className="space-y-4"
                >
                  <div className="space-y-4">
                    {/* New Password */}
                    <motion.div
                      className="relative"
                      whileFocus={{ scale: 1.01 }}
                      whileHover={{ scale: 1.01 }}
                    >
                      <div className="relative flex items-center bg-white overflow-hidden rounded-xl border border-stone-200 shadow-sm focus-within:border-stone-400 focus-within:ring-1 focus-within:ring-stone-400 transition-all">
                        <Lock className={`absolute left-3 w-4 h-4 transition-colors duration-300 ${focusedInput === "password" ? 'text-stone-900' : 'text-stone-400'}`} />
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="New password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          onFocus={() => setFocusedInput("password")}
                          onBlur={() => setFocusedInput(null)}
                          required
                          className="w-full border-none shadow-none h-11 pl-10 pr-10 bg-transparent focus-visible:ring-0"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 p-1 text-stone-400 hover:text-stone-800"
                        >
                          {showPassword ? <Eye className="w-4 h-4" /> : <EyeClosed className="w-4 h-4" />}
                        </button>
                      </div>
                    </motion.div>

                    {/* Confirm Password */}
                    <motion.div
                      className="relative"
                      whileFocus={{ scale: 1.01 }}
                      whileHover={{ scale: 1.01 }}
                    >
                      <div className="relative flex items-center bg-white overflow-hidden rounded-xl border border-stone-200 shadow-sm focus-within:border-stone-400 focus-within:ring-1 focus-within:ring-stone-400 transition-all">
                        <Lock className={`absolute left-3 w-4 h-4 transition-colors duration-300 ${focusedInput === "confirm" ? 'text-stone-900' : 'text-stone-400'}`} />
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="Confirm new password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          onFocus={() => setFocusedInput("confirm")}
                          onBlur={() => setFocusedInput(null)}
                          required
                          className="w-full border-none shadow-none h-11 pl-10 pr-3 bg-transparent focus-visible:ring-0"
                        />
                      </div>
                    </motion.div>
                  </div>

                  {error && (
                    <p className="text-sm text-red-600 font-medium">{error}</p>
                  )}

                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    type="submit"
                    disabled={isLoading}
                    className="w-full relative mt-6 h-11"
                  >
                    <div className="relative w-full h-full flex items-center justify-center bg-stone-900 text-white font-medium rounded-xl overflow-hidden hover:bg-stone-800 transition-colors shadow-sm active:shadow-none">
                      {isLoading ? (
                        <div className="w-4 h-4 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <span className="flex items-center justify-center gap-2 text-sm">
                          Update Password
                          <ArrowRight className="w-4 h-4" />
                        </span>
                      )}
                    </div>
                  </motion.button>
                </motion.form>
              ) : (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center py-4 space-y-4"
                >
                  <div className="mx-auto w-12 h-12 rounded-full bg-green-50 flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-lg font-semibold text-stone-900">Password Updated</h2>
                    <p className="text-sm text-stone-500">
                      Your password has been changed successfully. Redirecting you to login...
                    </p>
                  </div>
                  <Link
                    to="/login"
                    className="inline-flex items-center gap-2 text-sm font-medium text-stone-900 hover:text-blue-700 transition-colors"
                  >
                    Back to login now
                  </Link>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
