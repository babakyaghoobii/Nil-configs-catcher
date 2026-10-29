import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: false,
    outDir:
      mode === "desktop"
        ? "dist-desktop"
        : mode === "hosted"
          ? "dist-hosted"
          : "dist",
  },
  server: { host: "0.0.0.0" },
  plugins:
    mode === "desktop" || mode === "hosted"
      ? [
          {
            name: "repository-data-policy",
            transformIndexHtml(html: string) {
              return html.replace(
                "connect-src 'self'",
                `connect-src 'self'${mode === "desktop" ? " ipc: http://ipc.localhost" : ""} https://raw.githubusercontent.com`,
              );
            },
          },
        ]
      : [],
}));
