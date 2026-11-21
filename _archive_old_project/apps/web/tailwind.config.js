/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#0B0F17',
        foreground: '#F8FAFC',
        card: {
          DEFAULT: '#111827',
          foreground: '#F8FAFC',
          hover: '#1A2332',
        },
        popover: {
          DEFAULT: '#111827',
          foreground: '#F8FAFC',
        },
        border: '#1E293B',
        input: '#1E293B',
        ring: '#10B981',
        primary: {
          DEFAULT: '#10B981',
          foreground: '#022C22',
        },
        secondary: {
          DEFAULT: '#1E293B',
          foreground: '#F8FAFC',
        },
        muted: {
          DEFAULT: '#1E293B',
          foreground: '#94A3B8',
        },
        accent: {
          DEFAULT: '#10B981',
          foreground: '#022C22',
          hover: '#059669',
        },
        destructive: {
          DEFAULT: '#EF4444',
          foreground: '#FFFFFF',
        },
      },
      keyframes: {
        glow: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
      animation: {
        glow: 'glow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
