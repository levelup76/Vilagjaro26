import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [],
  server: {
    proxy: {
      '/overpass': {
        target: 'https://overpass-api.de',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/overpass/, '/api')
      }
    }
  }
})
