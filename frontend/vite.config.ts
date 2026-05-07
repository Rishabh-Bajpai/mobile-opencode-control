import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendPort = process.env.BACKEND_PORT || "38473";
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS || process.env.FRONTEND_ALLOWED_HOSTS || "localhost,127.0.0.1")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);


export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts,
    proxy: {
      "/api": {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
