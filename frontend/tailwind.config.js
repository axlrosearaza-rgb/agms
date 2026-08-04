/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
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
