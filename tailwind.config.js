/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Mirror of `brand` in constants/colors.ts — keep the two in step.
        brand: {
          primary: "#F59433",
          "primary-light": "#FFB166",
          accent: "#33D6A6",
        },
        semantic: {
          success: "#33D6A6",
          warning: "#FF9933",
          error: "#FF5959",
        },
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "14px",
        xl: "16px",
        navbar: "28px",
      },
    },
  },
  plugins: [],
};
