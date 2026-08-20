import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        wardGold: '#c9a227',
        ink: '#071019',
        panel: '#0d1824',
        panel2: '#122236'
      }
    }
  },
  plugins: []
};
export default config;
