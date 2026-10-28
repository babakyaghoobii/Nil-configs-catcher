import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: false,
    outDir: mode === "desktop" ? "dist-desktop" : "dist",
  },
  server: { host: "0.0.0.0" },
  plugins:
    mode === "desktop"
      ? [
          {
            name: "desktop-data-policy",
            transformIndexHtml(html: string) {
              return html.replace(
                "connect-src 'self'",
                "connect-src 'self' ipc: http://ipc.localhost https://raw.githubusercontent.com",
              );
            },
          },
        ]
      : [],
}));
