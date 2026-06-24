import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        // ---- Airtable editorial system: white canvas, dark ink ----
        // Surfaces (kept names so existing classes remap automatically).
        base: "#ffffff", // app background — white canvas
        surface: "#f8fafc", // soft panels (surface-soft)
        elevated: "#ffffff", // raised cards sit on canvas, separated by hairline
        line: "#dddddd", // hairline border tone
        "line-strong": "#9297a0",

        // Ink scale for type.
        ink: "#181d26",
        body: "#333840",
        muted: "#41454d",

        // "brand" = near-black primary (Airtable's brand action IS ink).
        brand: {
          50: "#f8fafc",
          400: "#41454d",
          500: "#181d26",
          600: "#0d1218",
          700: "#0d1218",
        },

        // Signature card surfaces (brand voltage).
        coral: "#aa2d00",
        forest: "#0a2e0e",
        cream: "#f5e9d4",
        peach: "#fcab79",
        mint: "#a8d8c4",
        sigyellow: "#f4d35e",
        mustard: "#d9a441",
        "surface-dark": "#181d26",

        link: "#1b61c9",

        // Semantic — remapped to Airtable's success/info + a warm caution.
        go: "#006400", // success green
        block: "#aa2d00", // coral/oxide red for blocks
        pending: "#d9a441", // mustard for pending/caution
      },
      backgroundImage: {
        // Kept name; now a flat ink fill (no gradient in this system).
        "brand-grad": "linear-gradient(0deg, #181d26, #181d26)",
        "brand-soft": "linear-gradient(0deg, #f8fafc, #f8fafc)",
      },
      borderRadius: {
        // Airtable radius scale.
        xs: "2px",
        sm: "6px",
        md: "10px",
        lg: "12px",
        pill: "9999px",
      },
      boxShadow: {
        // Color-block first, shadow second. Keep names but make them subtle.
        glow: "0 1px 2px rgba(24,29,38,.06), 0 1px 0 rgba(24,29,38,.04)",
        card: "0 1px 2px rgba(24,29,38,.05)",
        lift: "0 4px 16px -6px rgba(24,29,38,.14)",
      },
      keyframes: {
        float: {
          "0%,100%": { transform: "translateY(0) scale(1)" },
          "50%": { transform: "translateY(-18px) scale(1.04)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        float: "float 14s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
