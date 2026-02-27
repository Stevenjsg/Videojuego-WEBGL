import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // Esto habilita CORS para cualquier origen (útil en desarrollo)
    cors: true,
    // O si quieres ser específico:
    // cors: { origin: "*" }
  },
});
