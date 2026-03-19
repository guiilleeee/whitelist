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
        accent2: "#7C5CFF",
        glow: "#2A90FF",
        soft: "#0F1319",
        text: "#E6EAF0",
        muted: "#A7B0BB",
        surface: "#151A22",
        neon: "#36E1FF"
      },
      fontFamily: {
        display: ["Space Grotesk", "ui-sans-serif", "system-ui"],
        body: ["Inter", "ui-sans-serif", "system-ui"]
      },
      boxShadow: {
        soft: "0 18px 60px rgba(0, 0, 0, 0.45)",
        glow: "0 12px 40px rgba(42, 144, 255, 0.22)",
        neon: "0 10px 40px rgba(124, 92, 255, 0.25)"
      },
      keyframes: {
        fadeInUp: {
          "0%": { opacity: 0, transform: "translateY(12px)" },
          "100%": { opacity: 1, transform: "translateY(0)" }
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-8px)" }
        },
        shimmer: {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "200% 50%" }
        }
      },
      animation: {
        fadeInUp: "fadeInUp 0.6s ease-out",
        float: "float 6s ease-in-out infinite",
        shimmer: "shimmer 6s linear infinite"
      }
    }
  },
  plugins: []
};
