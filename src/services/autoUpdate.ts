import { confirm, message } from "@tauri-apps/plugin-dialog";
import { platform } from "@tauri-apps/plugin-os";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { version as APP_VERSION } from "../../package.json";

const SKIPPED_UPDATE_KEY = "pk_skipped_update_version";
const LATEST_RELEASE_URL = "https://api.github.com/repos/Praesens-tech/passwordKeeper/releases/latest";

type UpdateCheckMode = "startup" | "manual";

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  body?: string;
  assets?: { name: string; browser_download_url: string }[];
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function compareVersions(left: string, right: string): number {
  const a = normalizeVersion(left).split(/[.+-]/)[0].split(".").map(Number);
  const b = normalizeVersion(right).split(/[.+-]/)[0].split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function getSkippedVersion(): string | null {
  try {
    return localStorage.getItem(SKIPPED_UPDATE_KEY);
  } catch {
    return null;
  }
}

function setSkippedVersion(version: string) {
  try {
    localStorage.setItem(SKIPPED_UPDATE_KEY, version);
  } catch {
    // Best effort only.
  }
}

async function nativeJson<T>(url: string): Promise<T> {
  const raw = await invoke<string>("native_fetch", {
    method: "GET",
    url,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Password-Keeper",
    },
    body: null,
  });
  const response = JSON.parse(raw) as { status: number; body: string };
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`);
  }
  return JSON.parse(response.body) as T;
}

async function checkDesktopUpdate(mode: UpdateCheckMode) {
  const update = await check();
  if (!update) {
    if (mode === "manual") {
      await message("Você já está usando a versão mais recente.", {
        title: "Atualização",
        kind: "info",
      });
    }
    return;
  }

  if (mode === "startup" && getSkippedVersion() === update.version) {
    await update.close();
    return;
  }

  const shouldUpdate = await confirm(
    `A versão ${update.version} está disponível. Deseja baixar e instalar agora?`,
    {
      title: "Atualização disponível",
      kind: "info",
    },
  );

  if (!shouldUpdate) {
    setSkippedVersion(update.version);
    await update.close();
    await message("Tudo bem. Você pode atualizar depois em Ajuda > Atualizar.", {
      title: "Atualização adiada",
      kind: "info",
    });
    return;
  }

  await update.downloadAndInstall();
  await message("Atualização instalada. O Password Keeper será reiniciado.", {
    title: "Atualização instalada",
    kind: "info",
  });
  await relaunch();
}

async function checkAndroidUpdate(mode: UpdateCheckMode) {
  const release = await nativeJson<GitHubRelease>(LATEST_RELEASE_URL);
  const latestVersion = normalizeVersion(release.tag_name);
  if (compareVersions(latestVersion, APP_VERSION) <= 0) {
    if (mode === "manual") {
      await message("Você já está usando a versão mais recente.", {
        title: "Atualização",
        kind: "info",
      });
    }
    return;
  }

  if (mode === "startup" && getSkippedVersion() === release.tag_name) return;

  const shouldUpdate = await confirm(
    `A versão ${release.tag_name} está disponível. Deseja abrir o download do APK agora?`,
    {
      title: "Atualização disponível",
      kind: "info",
    },
  );

  if (!shouldUpdate) {
    setSkippedVersion(release.tag_name);
    await message("Tudo bem. Você pode atualizar depois quando o app avisar novamente ou pela página de download.", {
      title: "Atualização adiada",
      kind: "info",
    });
    return;
  }

  const apk = release.assets?.find((asset) => asset.name.endsWith("-android.apk"));
  await invoke("open_url", { url: apk?.browser_download_url ?? release.html_url });
}

export async function checkForAppUpdate(mode: UpdateCheckMode = "manual") {
  try {
    if (platform() === "android") {
      await checkAndroidUpdate(mode);
      return;
    }
    await checkDesktopUpdate(mode);
  } catch (err) {
    if (mode === "manual") {
      await message(`Não foi possível verificar atualizações agora.\n\n${String(err)}`, {
        title: "Atualização",
        kind: "error",
      });
    }
  }
}
