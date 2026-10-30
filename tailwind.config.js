/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        aws: {
          navy: '#0f172a',
          panel: '#1e293b',
          orange: '#ff9900',
          orangeHover: '#e68a00'
        }
      }
    }
  },
  plugins: []
}

