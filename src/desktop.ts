// Native integrations are loaded only in the bundled desktop build.
export const isDesktop = import.meta.env.MODE === "desktop";
export const repositoryDataURL =
  "https://raw.githubusercontent.com/babakyaghoobii/Nil-configs-catcher/main/public/data/";

export async function writeNativeClipboard(text: string): Promise<void> {
  const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
  await writeText(text);
}

export async function saveNativeExport(
  filename: string,
  text: string,
): Promise<boolean> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    defaultPath: filename,
    filters: [{ name: "VPN subscription", extensions: ["txt"] }],
  });
  if (path === null) return false;
  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  await writeTextFile(path, text);
  return true;
}

export async function openNativeGitHubLink(value: string): Promise<void> {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("Unapproved external destination");
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url.href);
}
