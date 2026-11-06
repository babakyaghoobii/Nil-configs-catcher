import { defineConfig } from "vite";
import { existsSync, readFileSync } from "node:fs";

const deploymentFile = new URL("./deployment.json", import.meta.url);
const serviceOrigin = existsSync(deploymentFile)
  ? JSON.parse(readFileSync(deploymentFile, "utf8")).serviceOrigin
  : "https://nil-config-catcher-babakyaghoobii.lovable.app";
if (
  typeof serviceOrigin !== "string" ||
  !/^https:\/\/(nil-config-catcher\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.workers\.dev|nil-config-catcher-babakyaghoobii\.(lovable|higgsfield)\.app)$/.test(
    serviceOrigin,
  )
) {
  throw new Error("Invalid checked-in NIL service origin");
}

export default defineConfig(({ mode }) => ({
  base: "./",
  define: { __NIL_SERVICE_ORIGIN__: JSON.stringify(serviceOrigin) },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: { input: ["index.html", "proxy/index.html"] },
    outDir:
      mode === "desktop"
        ? "dist-desktop"
        : mode === "hosted"
          ? "dist-hosted"
          : "dist",
  },
  server: { host: "0.0.0.0" },
  plugins: [
    {
      name: "repository-data-policy",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "proxy/apple-touch-icon.png",
          source: readFileSync(new URL("./public/icons/apple-touch-icon.png", import.meta.url)),
        });
      },
      transformIndexHtml(html: string) {
        return html.replace(
          "connect-src 'self'",
          `connect-src 'self'${mode === "desktop" ? " ipc: http://ipc.localhost" : ""} https://raw.githubusercontent.com ${serviceOrigin}`,
        );
      },
    },
  ],
}));
