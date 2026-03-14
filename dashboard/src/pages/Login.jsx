import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { motion, AnimatePresence, useMotionValue, useTransform } from "framer-motion";
import { Mail, Lock, Eye, EyeClosed, ArrowRight } from "lucide-react";
import { login, signup } from "../api";
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

export default function Login({ onLogin }) {
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState(() => searchParams.get("signup") === "1" ? "signup" : "login");
  const isSignup = mode === "signup";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [focusedInput, setFocusedInput] = useState(null);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  // Gentle 3D rotation map
  const rotateX = useTransform(mouseY, [-300, 300], [4, -4]);
  const rotateY = useTransform(mouseX, [-300, 300], [-4, 4]);

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set(e.clientX - rect.left - rect.width / 2);
    mouseY.set(e.clientY - rect.top - rect.height / 2);
  };

  const handleMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      if (isSignup) {
        await signup(email, password);
      } else {
        await login(email, password);
      }
      onLogin();
    } catch (err) {
      setError(err.message || (isSignup ? "Sign up failed" : "Login failed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-stone-50 relative overflow-hidden flex items-center justify-center">
      {/* Subtle animated background shapes for light theme */}
      <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-[120vh] h-[60vh] rounded-b-[50%] bg-stone-200/40 blur-[80px]" />
      <motion.div
        className="absolute top-0 left-1/2 transform -translate-x-1/2 w-[100vh] h-[60vh] rounded-b-full bg-stone-200/30 blur-[60px]"
        animate={{ opacity: [0.15, 0.4, 0.15], scale: [0.98, 1.02, 0.98] }}
        transition={{ duration: 8, repeat: Infinity, repeatType: "mirror" }}
      />
      <motion.div
        className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-[90vh] h-[90vh] rounded-t-full bg-stone-300/30 blur-[60px]"
        animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.05, 1] }}
        transition={{ duration: 6, repeat: Infinity, repeatType: "mirror", delay: 1 }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="w-full max-w-sm relative z-10 mx-4"
        style={{ perspective: 1500 }}
      >
        {/* The 3D wrapper */}
        <motion.div
          className="relative"
          style={{ rotateX, rotateY }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          whileHover={{ z: 10 }}
        >
          <div className="relative group">
            {/* The white glass card with slight shadow on hover */}
            <div className="relative bg-white/90 backdrop-blur-xl rounded-2xl p-6 sm:p-8 border border-stone-200 shadow-sm transition-all duration-300 group-hover:shadow-2xl group-hover:border-stone-300 overflow-hidden">

              {/* Subtle inner card pattern */}
              <div className="absolute inset-0 opacity-[0.02]"
                style={{
                  backgroundImage: `linear-gradient(135deg, #000 0.5px, transparent 0.5px), linear-gradient(45deg, #000 0.5px, transparent 0.5px)`,
                  backgroundSize: '24px 24px'
                }}
              />

              {/* Logo and header */}
              <div className="text-center space-y-1 mb-8 relative z-10">
                <motion.div
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", duration: 0.8 }}
                  className="mx-auto w-12 h-12 rounded-xl bg-gradient-to-br from-stone-900 to-stone-700 text-white flex items-center justify-center relative overflow-hidden shadow-lg"
                >
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2L14.85 8.65L22 9.25L16.5 13.9L18.1 21L12 17.25L5.9 21L7.5 13.9L2 9.25L9.15 8.65L12 2Z" fill="currentColor" />
                  </svg>
                </motion.div>

                <motion.h1
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-2xl font-bold tracking-tight text-stone-900 mt-4"
                >
                  {isSignup ? "Create account" : "Welcome Back"}
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="text-stone-500 text-sm"
                >
                  {isSignup ? "Get started with AI Front Desk Helper" : "Sign in to continue to AI Front Desk Helper"}
                </motion.p>
              </div>

              {/* Login form */}
              <form onSubmit={handleSubmit} className="space-y-4 relative z-10">
                <motion.div className="space-y-4">
                  {/* Email input */}
                  <motion.div
                    className={`relative ${focusedInput === "email" ? 'z-10' : ''}`}
                    whileFocus={{ scale: 1.01 }}
                    whileHover={{ scale: 1.01 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  >
                    <div className="absolute -inset-[1px] bg-gradient-to-r from-stone-200 via-stone-300 to-stone-200 rounded-xl opacity-0 group-hover:opacity-100 transition-all duration-300" />
                    <div className="relative flex items-center bg-white overflow-hidden rounded-xl border border-stone-200 shadow-sm focus-within:border-stone-400 focus-within:ring-1 focus-within:ring-stone-400 transition-all">
                      <Mail className={`absolute left-3 w-4 h-4 transition-colors duration-300 ${focusedInput === "email" ? 'text-stone-900' : 'text-stone-400'
                        }`} />

                      <Input
                        type="email"
                        placeholder="Email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onFocus={() => setFocusedInput("email")}
                        onBlur={() => setFocusedInput(null)}
                        required
                        className="w-full border-none shadow-none text-stone-900 placeholder:text-stone-400 h-11 pl-10 pr-3 bg-transparent focus-visible:ring-0"
                      />
                    </div>
                  </motion.div>

                  {/* Password input */}
                  <motion.div
                    className={`relative ${focusedInput === "password" ? 'z-10' : ''}`}
                    whileFocus={{ scale: 1.01 }}
                    whileHover={{ scale: 1.01 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  >
                    <div className="absolute -inset-[1px] bg-gradient-to-r from-stone-200 via-stone-300 to-stone-200 rounded-xl opacity-0 group-hover:opacity-100 transition-all duration-300" />
                    <div className="relative flex items-center bg-white overflow-hidden rounded-xl border border-stone-200 shadow-sm focus-within:border-stone-400 focus-within:ring-1 focus-within:ring-stone-400 transition-all">
                      <Lock className={`absolute left-3 w-4 h-4 transition-colors duration-300 ${focusedInput === "password" ? 'text-stone-900' : 'text-stone-400'
                        }`} />

                      <Input
                        type={showPassword ? "text" : "password"}
                        placeholder={isSignup ? "Password (min 8 characters)" : "Password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onFocus={() => setFocusedInput("password")}
                        onBlur={() => setFocusedInput(null)}
                        required
                        minLength={isSignup ? 8 : undefined}
                        className="w-full border-none shadow-none text-stone-900 placeholder:text-stone-400 h-11 pl-10 pr-10 bg-transparent focus-visible:ring-0"
                      />

                      <div
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 cursor-pointer p-1"
                      >
                        {showPassword ? (
                          <Eye className="w-4 h-4 text-stone-400 hover:text-stone-800 transition-colors" />
                        ) : (
                          <EyeClosed className="w-4 h-4 text-stone-400 hover:text-stone-800 transition-colors" />
                        )}
                      </div>
                    </div>
                  </motion.div>
                  {!isSignup && (
                    <div className="flex justify-end -mt-2">
                      <Link
                        to="/forgot-password"
                        className="text-xs font-medium text-stone-600 hover:text-stone-900 hover:underline underline-offset-2 transition-all"
                      >
                        Forgot Password?
                      </Link>
                    </div>
                  )}
                </motion.div>

                {error && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-red-600 font-medium">
                    {error}
                  </motion.p>
                )}

                {/* Submit button */}
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  type="submit"
                  disabled={isLoading}
                  className="w-full relative group/button mt-6 h-11"
                >
                  <div className="relative w-full h-full flex items-center justify-center bg-stone-900 text-white font-medium rounded-xl overflow-hidden hover:bg-stone-800 transition-colors shadow-sm active:shadow-none">
                    <AnimatePresence mode="wait">
                      {isLoading ? (
                        <motion.div
                          key="loading"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="flex items-center justify-center"
                        >
                          <div className="w-4 h-4 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                        </motion.div>
                      ) : (
                        <motion.span
                          key="button-text"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="flex items-center justify-center gap-2 text-sm"
                        >
                          {isSignup ? "Create account" : "Sign In"}
                          <ArrowRight className="w-4 h-4 group-hover/button:translate-x-1 transition-transform duration-300" />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.button>

                {/* Sign up/in toggle */}
                <motion.p
                  className="text-center text-sm text-stone-500 mt-6 pt-2"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                >
                  {isSignup ? "Already have an account?" : "Don't have an account?"}{' '}
                  <button
                    type="button"
                    onClick={() => { setMode(isSignup ? "login" : "signup"); setError(""); }}
                    className="relative inline-block font-medium text-stone-900 hover:text-stone-700 transition-colors group/link"
                  >
                    <span className="relative z-10">
                      {isSignup ? "Sign in" : "Sign up"}
                    </span>
                    <span className="absolute bottom-0 left-0 w-0 h-[1px] bg-stone-900 group-hover/link:w-full transition-all duration-300" />
                  </button>
                </motion.p>
              </form>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
