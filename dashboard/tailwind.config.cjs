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
      },
      colors: {
        brand: {
          50: "#fef7ee",
          100: "#fdedd6",
          200: "#f9d7ac",
          300: "#f4ba77",
          400: "#ee9240",
          500: "#ea751a",
          600: "#db5a10",
          700: "#b54310",
          800: "#903615",
          900: "#742f14",
          950: "#3f1508",
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
