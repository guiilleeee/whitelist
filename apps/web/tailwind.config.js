/** @type {import("tailwindcss").Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B0E13",
        panel: "#10141A",
        line: "#232A34",
        accent: "#FF4D8D",
        glow: "#2A90FF",
        soft: "#0F1319",
        text: "#E6EAF0",
        muted: "#A7B0BB"
      },
      fontFamily: {
        display: ["Space Grotesk", "ui-sans-serif", "system-ui"],
        body: ["Inter", "ui-sans-serif", "system-ui"]
      },
      boxShadow: {
        soft: "0 18px 60px rgba(0, 0, 0, 0.45)",
        glow: "0 12px 40px rgba(42, 144, 255, 0.22)"
      },
      keyframes: {
        fadeInUp: {
          "0%": { opacity: 0, transform: "translateY(12px)" },
          "100%": { opacity: 1, transform: "translateY(0)" }
        }
      },
      animation: {
        fadeInUp: "fadeInUp 0.6s ease-out"
      }
    }
  },
  plugins: []
};
