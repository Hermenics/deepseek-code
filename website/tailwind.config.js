/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Outfit"', "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ['"Playfair Display"', "ui-serif", "Georgia", "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        void: "#030303", surface: "#0A0A0A", elevated: "#121212",
        neon: { cyan: "#00F0FF", green: "#00FF41", amber: "#FFB000", blue: "#4D6BFE" },
        border: "hsl(var(--border))", background: "hsl(var(--background))", foreground: "hsl(var(--foreground))",
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
      },
      borderRadius: { none: "0px", sm: "2px" },
      letterSpacing: { tightest: "-0.06em", widestx: "0.35em" },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
