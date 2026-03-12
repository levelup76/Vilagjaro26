import { defineConfig } from "vite"
import { resolve }      from "path"

export default defineConfig({
  publicDir: false,
  build: {
    outDir:      "dist/lib",
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry:    resolve(__dirname, "src/vilagjaro-adapter.ts"),
      name:     "Vilagjaro",
      formats:  ["es"],
      fileName: "vilagjaro",
    },
    rollupOptions: {
      external: ["ol", /^ol\//, "osmtogeojson"],
      output: {
        globals: {
          "ol":           "ol",
          "osmtogeojson": "osmtogeojson",
        },
      },
    },
  },
})
