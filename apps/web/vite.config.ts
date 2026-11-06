import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// GitHub Pages project-site base path.
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES === "true" ? "/tank-turn-tactics/" : "/",
});