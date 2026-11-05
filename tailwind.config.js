/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        vault: {
          bg: "#FAECE7",
          sidebar: "#F5C4B3",
          card: "#ffffff",
          cardHover: "#FAECE7",
          border: "#E8B19D",
          primary: "#993C1D",
          primaryHover: "#4A1B0C",
          secondary: "#D85A30",
          accent: "#F0997B",
          success: "#22c55e",
          warning: "#993C1D",
          danger: "#B42318",
          text: "#4A1B0C",
          textMuted: "#65483e",
          textSecondary: "#65483e",
          input: "#ffffff",
        },
      },
      fontFamily: {
        sans: ["Arial", "Helvetica", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-in": "slideIn 0.2s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
        shimmer: "shimmer 2s linear infinite",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideIn: {
          from: { opacity: "0", transform: "translateX(-10px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          from: { backgroundPosition: "200% center" },
          to: { backgroundPosition: "-200% center" },
        },
      },
    },
  },
  plugins: [],
};
