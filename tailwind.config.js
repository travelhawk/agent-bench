/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["src/ui/public/**/*.html", "src/ui/public/**/*.js"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Manrope'", "system-ui", "sans-serif"]
      },
      colors: {
        surface: {
          900: "#040b1e",
          800: "#0a1630",
          700: "#0f2142"
        }
      },
      boxShadow: {
        panel: "0 10px 40px rgba(0, 0, 0, 0.35)"
      }
    }
  },
  plugins: []
};