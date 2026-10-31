import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#0f172a",
          950: "#020617",
        },
        solar: {
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
        },
        eco: {
          500: "#10b981",
          600: "#059669",
        }
      },
    },
  },
  plugins: [],
};
export default config;
