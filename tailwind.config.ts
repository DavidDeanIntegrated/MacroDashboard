import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Apple-inspired color system
        surface: {
          DEFAULT: 'rgba(255, 255, 255, 0.72)',
          secondary: 'rgba(255, 255, 255, 0.50)',
          elevated: 'rgba(255, 255, 255, 0.90)',
        },
        border: {
          DEFAULT: 'rgba(0, 0, 0, 0.06)',
          strong: 'rgba(0, 0, 0, 0.12)',
        },
        label: {
          primary: 'rgba(0, 0, 0, 0.85)',
          secondary: 'rgba(0, 0, 0, 0.55)',
          tertiary: 'rgba(0, 0, 0, 0.35)',
        },
        accent: {
          blue: '#007AFF',
          green: '#34C759',
          red: '#FF3B30',
          orange: '#FF9500',
          yellow: '#FFCC00',
          purple: '#AF52DE',
          teal: '#5AC8FA',
          indigo: '#5856D6',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"SF Pro Text"',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        mono: [
          '"SF Mono"',
          'SFMono-Regular',
          'ui-monospace',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        'xxs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      borderRadius: {
        'xl': '0.875rem',
        '2xl': '1.25rem',
        '3xl': '1.5rem',
      },
      backdropBlur: {
        'xl': '20px',
        '2xl': '40px',
      },
      boxShadow: {
        'subtle': '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06)',
        'card': '0 2px 8px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.06)',
        'elevated': '0 8px 30px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)',
        'float': '0 20px 60px rgba(0, 0, 0, 0.12), 0 4px 16px rgba(0, 0, 0, 0.06)',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'pulse-subtle': 'pulseSubtle 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
    },
  },
  plugins: [],
};
export default config;
