import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  // PERF (QW-13 audit jun/2026): lib/ removido — nenhum ficheiro em lib
  // contém classes Tailwind. Reduz o conjunto de ficheiros que o
  // Tailwind escava em cada build.
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // LEAP premium palette
        ink: {
          900: "#0A0A0A",
          800: "#111111",
          700: "#1A1A1A",
          600: "#262626",
          500: "#3F3F3F",
        },
        gold: {
          50: "#FBF7E8",
          100: "#F4ECC4",
          200: "#E8D88A",
          300: "#DCC450",
          400: "#CFB325",
          500: "#B89A15",
          600: "#8E7610",
          700: "#65540B",
        },
        bone: {
          50: "#FAFAF7",
          100: "#F2F1EA",
          200: "#E5E3D6",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 2px 12px rgba(0,0,0,0.06)",
        glow: "0 0 0 1px rgba(207,179,37,0.25), 0 8px 24px rgba(207,179,37,0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
