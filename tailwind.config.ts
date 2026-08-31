import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#090a08",
          900: "#10120c",
          800: "#181b12",
          700: "#232818",
        },
        lime: {
          DEFAULT: "#d6ff4b",
          dim: "#9fbf2e",
        },
        mist: "#a4aa90",
        line: "#2c3220",
      },
      fontFamily: {
        display: ["var(--font-syne)", "system-ui", "sans-serif"],
        sans: ["var(--font-plex)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      backgroundImage: {
        grain:
          "radial-gradient(ellipse at top, rgba(214,255,75,0.06), transparent 55%), radial-gradient(ellipse at bottom, rgba(125,211,192,0.05), transparent 50%)",
      },
    },
  },
  plugins: [],
};

export default config;
