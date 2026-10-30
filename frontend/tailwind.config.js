/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        qb: {
          green: "#009944",
          dark: "#1a1a2e",
          gray: "#f5f5f5",
        },
      },
    },
  },
  plugins: [],
}
