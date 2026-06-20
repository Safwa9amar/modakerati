/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#5C6BFF",
          "primary-light": "#7A8CFF",
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
