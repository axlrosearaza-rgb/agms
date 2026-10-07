/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  // <Badge variant="green"> builds its class name at runtime (`badge-${variant}`),
  // so Tailwind never sees "badge-green" etc. written out and would drop them —
  // leaving every badge colorless. Always keep the badge color classes.
  safelist: [{ pattern: /^badge-(green|red|blue|yellow|purple|orange|gray|it|is-red|golden-yellow|lavender)$/ }],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#1B3A5C', dark: '#142d48', light: '#2a5280' },
        gold: { DEFAULT: '#C9A84C', light: '#d4b96a', dark: '#b08f3a' },
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['Playfair Display', 'serif'],
      },
    },
  },
  plugins: [],
};
