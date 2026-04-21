/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
        serif: ["Source Serif 4", "Georgia", "serif"],
      },
      colors: {
        // Brand scale — reads from CSS variables set by BrandProvider.
        // Defaults (AI Front Desk Helper orange) are defined in index.css :root
        brand: {
          50:  "rgb(var(--brand-50)  / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          200: "rgb(var(--brand-200) / <alpha-value>)",
          300: "rgb(var(--brand-300) / <alpha-value>)",
          400: "rgb(var(--brand-400) / <alpha-value>)",
          500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)",
          700: "rgb(var(--brand-700) / <alpha-value>)",
          800: "rgb(var(--brand-800) / <alpha-value>)",
          900: "rgb(var(--brand-900) / <alpha-value>)",
          950: "rgb(var(--brand-950) / <alpha-value>)",
        },
      },
      animation: {
        "shimmer-slide":
          "shimmer-slide var(--speed) ease-in-out infinite alternate",
        "spin-around": "spin-around calc(var(--speed) * 2) infinite linear",
        "loaderAnim": "loaderAnim 2.5s infinite",
      },
      keyframes: {
        "shimmer-slide": {
          to: { transform: "translate(calc(100cqw - 100%), 0)" },
        },
        "spin-around": {
          "0%": { transform: "translateZ(0) rotate(0)" },
          "15%, 35%": { transform: "translateZ(0) rotate(90deg)" },
          "65%, 85%": { transform: "translateZ(0) rotate(270deg)" },
          "100%": { transform: "translateZ(0) rotate(360deg)" },
        },
        "loaderAnim": {
          "0%": { inset: "0 35px 35px 0" },
          "12.5%": { inset: "0 35px 0 0" },
          "25%": { inset: "35px 35px 0 0" },
          "37.5%": { inset: "35px 0 0 0" },
          "50%": { inset: "35px 0 0 35px" },
          "62.5%": { inset: "0 0 0 35px" },
          "75%": { inset: "0 0 35px 35px" },
          "87.5%": { inset: "0 0 35px 0" },
          "100%": { inset: "0 35px 35px 0" },
        },
      },
    },
  },
  plugins: [],
};
