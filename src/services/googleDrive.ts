import { invoke } from "@tauri-apps/api/core";
import { GoogleToken } from "../types/vault";

/**
 * Fetch via tauri-plugin-http (Drive API, userinfo, refresh token).
 * Desktop: reqwest bypassa CORS do WebView.
 * Android: requer que o app tenha permissão de internet nas configurações do MIUI
 *   (Configurações → Apps → Password Keeper → Uso de dados → ativar Wi-Fi e Dados móveis).
 */
async function rustFetch(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ ok: boolean; status: number; text: () => string; json: () => unknown }> {
  const raw = await invoke<string>("native_fetch", {
    method,
    url,
    headers,
    body: body ?? null,
  });
  const response = JSON.parse(raw) as { status: number; body: string };
  const text = response.body;
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    text: () => text,
    json: () => JSON.parse(text),
  };
}
import {
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ANDROID_CLIENT_ID,
  OAUTH_ANDROID_REDIRECT, VAULT_DRIVE_FILENAME, OAUTH_PORT,
} from "../config";

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ─── OAuth ────────────────────────────────────────────────────────────────────

/**
 * Inicia o fluxo OAuth PKCE.
 * Todas as plataformas → servidor TCP local na porta 8899 + browser externo.
 * No Android, Chrome conecta ao localhost do próprio dispositivo onde o servidor TCP roda.
 */
export async function startOAuthFlow(forceConsent = false): Promise<GoogleToken> {
  if (/android/i.test(navigator.userAgent)) {
    return startOAuthAndroid(forceConsent);
  }
  return startOAuthDesktop(forceConsent);
}

async function startOAuthAndroid(forceConsent: boolean): Promise<GoogleToken> {
  if (!GOOGLE_ANDROID_CLIENT_ID) {
    throw new Error("Configure VITE_GOOGLE_ANDROID_CLIENT_ID no arquivo .env para usar o Google Drive no Android.");
  }
  const tokenJson = await invoke<string>("start_oauth_android_native", {
    clientId: GOOGLE_ANDROID_CLIENT_ID,
    redirectUri: OAUTH_ANDROID_REDIRECT,
    scopes: SCOPES,
    forceConsent,
  });
  const token = JSON.parse(tokenJson) as GoogleToken;
  return { ...token, client_id: GOOGLE_ANDROID_CLIENT_ID };
}

// ─── Desktop OAuth (TCP listener) ─────────────────────────────────────────────

async function startOAuthDesktop(forceConsent: boolean): Promise<GoogleToken> {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const redirectUri = `http://localhost:${OAUTH_PORT}`;
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    ...(forceConsent ? { prompt: "consent" } : {}),
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  // O Chrome (browser externo) faz o token exchange — bypassa restrições de rede do app.
  // start_oauth retorna o token JSON diretamente.
  const tokenJson = await invoke<string>("start_oauth", {
    authUrl,
    port: OAUTH_PORT,
    codeVerifier: verifier,
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri,
    expectedState: state,
  });

  const data = JSON.parse(tokenJson) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
  };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    token_type: data.token_type,
    client_id: GOOGLE_CLIENT_ID,
  };
}

// ─── Refresh token ────────────────────────────────────────────────────────────

export async function refreshAccessToken(refreshToken: string, clientId = GOOGLE_CLIENT_ID): Promise<GoogleToken> {
  const body: Record<string, string> = {
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  };
  if (clientId === GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    body.client_secret = GOOGLE_CLIENT_SECRET;
  }

  const res = await rustFetch(
    "POST",
    "https://oauth2.googleapis.com/token",
    { "Content-Type": "application/x-www-form-urlencoded" },
    new URLSearchParams(body).toString(),
  );

  if (!res.ok) throw new Error("Falha ao renovar token. Faça login novamente.");
  const data = res.json() as { access_token: string; expires_in: number; token_type: string };
  return {
    access_token: data.access_token,
    refresh_token: refreshToken,
    expires_at: Date.now() + data.expires_in * 1000,
    token_type: data.token_type,
    client_id: clientId,
  };
}

export async function getUserInfo(accessToken: string): Promise<{ email: string; name: string; picture: string }> {
  const res = await rustFetch("GET", "https://www.googleapis.com/oauth2/v2/userinfo", { Authorization: `Bearer ${accessToken}` });
  if (!res.ok) throw new Error("Falha ao obter informações do usuário");
  return res.json() as { email: string; name: string; picture: string };
}

// ─── Drive API ────────────────────────────────────────────────────────────────

async function authHeaders(token: GoogleToken) {
  return { Authorization: `Bearer ${token.access_token}` };
}

export async function findVaultFile(token: GoogleToken): Promise<string | null> {
  const files = await findAllVaultFiles(token);
  return files[0]?.id ?? null;
}

/** Returns all .keep files the user has access to in Drive. */
export async function findAllVaultFiles(token: GoogleToken): Promise<{ id: string; name: string }[]> {
  const headers = await authHeaders(token);
  const query = encodeURIComponent(`name contains '.keep' and not name contains 'pk-collab-' and trashed=false`);
  const res = await rustFetch("GET", `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&orderBy=name`, headers);
  if (!res.ok) throw new Error("Erro ao buscar arquivos no Drive");
  const data = res.json() as { files?: { id: string; name: string }[] };
  return (data.files ?? []);
}

/** Returns collaborative .keep files shared with the user or owned by them. */
export async function findAllCollaborativeVaultFiles(token: GoogleToken): Promise<{ id: string; name: string; ownerEmail?: string }[]> {
  const headers = await authHeaders(token);
  const query = encodeURIComponent(`name contains '.keep' and trashed=false`);
  const res = await rustFetch("GET", `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,owners(emailAddress))&orderBy=modifiedTime desc`, headers);
  if (!res.ok) throw new Error("Erro ao buscar compartilhamentos no Drive");
  const data = res.json() as { files?: { id: string; name: string; owners?: { emailAddress?: string }[] }[] };
  return (data.files ?? [])
    .filter((file) => file.name.includes("pk-collab-"))
    .map((file) => ({ id: file.id, name: file.name, ownerEmail: file.owners?.[0]?.emailAddress }));
}

export async function getFileVersion(token: GoogleToken, fileId: string): Promise<string> {
  const headers = await authHeaders(token);
  const res = await rustFetch("GET", `https://www.googleapis.com/drive/v3/files/${fileId}?fields=headRevisionId,modifiedTime`, headers);
  if (!res.ok) throw new Error(`Erro ao verificar versão do arquivo no Drive (${res.status}): ${res.text()}`);
  const data = res.json() as { headRevisionId?: string; modifiedTime?: string };
  return data.headRevisionId ?? data.modifiedTime ?? "";
}

export async function downloadVaultFile(token: GoogleToken, fileId: string): Promise<string> {
  const headers = await authHeaders(token);
  const res = await rustFetch("GET", `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, headers);
  if (!res.ok) throw new Error(`Erro ao baixar cofre do Drive (${res.status}): ${res.text()}`);
  return res.text();
}

export async function deleteDriveFile(token: GoogleToken, fileId: string): Promise<void> {
  const headers = await authHeaders(token);
  const res = await rustFetch("DELETE", `https://www.googleapis.com/drive/v3/files/${fileId}`, headers);
  if (!res.ok && res.status !== 404) throw new Error(`Erro ao cancelar compartilhamento no Drive (${res.status}): ${res.text()}`);
}

export async function uploadVaultFile(
  token: GoogleToken,
  content: string,
  existingFileId?: string
): Promise<string> {
  const headers = await authHeaders(token);

  if (existingFileId) {
    // Update existing file
    const res = await rustFetch(
      "PATCH",
      `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`,
      { ...headers, "Content-Type": "application/octet-stream" },
      content,
    );
    if (!res.ok) throw new Error(`Erro ao atualizar cofre no Drive (${res.status}): ${res.text()}`);
    return existingFileId;
  } else {
    // Create new file (multipart upload)
    const metadata = JSON.stringify({ name: VAULT_DRIVE_FILENAME, mimeType: "application/octet-stream" });
    const boundary = "vault_boundary_" + crypto.randomUUID().replace(/-/g, "");
    const multipart = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      metadata,
      `--${boundary}`,
      "Content-Type: application/octet-stream",
      "",
      content,
      `--${boundary}--`,
    ].join("\r\n");

    const res = await rustFetch(
      "POST",
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      { ...headers, "Content-Type": `multipart/related; boundary=${boundary}` },
      multipart,
    );
    if (!res.ok) throw new Error(`Erro ao criar cofre no Drive (${res.status}): ${res.text()}`);
    const data = res.json() as { id: string };
    return data.id;
  }
}

export async function shareFile(
  token: GoogleToken,
  fileId: string,
  email: string,
  role: "reader" | "writer" = "reader",
  emailMessage?: string,
): Promise<void> {
  const headers = await authHeaders(token);
  const res = await rustFetch(
    "POST",
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=true`,
    { ...headers, "Content-Type": "application/json" },
    JSON.stringify({ role, type: "user", emailAddress: email, ...(emailMessage ? { emailMessage } : {}) }),
  );
  if (!res.ok) {
    const err = res.json() as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Erro ao compartilhar arquivo (${res.status}): ${res.text()}`);
  }
}

// ─── Drive Changes API (long-poll quasi-realtime) ─────────────────────────────

/**
 * Obtém um pageToken inicial para começar a observar mudanças no Drive.
 * Deve ser chamado uma vez ao conectar ou reabrir o cofre.
 */
export async function getDriveChangesStartToken(token: GoogleToken): Promise<string> {
  const headers = await authHeaders(token);
  const res = await rustFetch(
    "GET",
    "https://www.googleapis.com/drive/v3/changes/startPageToken",
    headers,
  );
  if (!res.ok) throw new Error(`Erro ao obter startPageToken (${res.status}): ${res.text()}`);
  const data = res.json() as { startPageToken: string };
  return data.startPageToken;
}

/**
 * Lista mudanças desde o pageToken fornecido.
 * Retorna os IDs de arquivos alterados e o próximo pageToken.
 * Use `includeRemoved=false` para ignorar exclusões.
 */
export async function listDriveChanges(
  token: GoogleToken,
  pageToken: string,
): Promise<{ changedFileIds: string[]; nextPageToken: string }> {
  const headers = await authHeaders(token);
  const params = new URLSearchParams({
    pageToken,
    fields: "nextPageToken,newStartPageToken,changes(fileId,removed)",
    spaces: "drive",
    includeRemoved: "false",
  });
  const res = await rustFetch(
    "GET",
    `https://www.googleapis.com/drive/v3/changes?${params}`,
    headers,
  );
  if (!res.ok) throw new Error(`Erro ao listar mudanças (${res.status}): ${res.text()}`);
  const data = res.json() as {
    nextPageToken?: string;
    newStartPageToken?: string;
    changes?: { fileId: string; removed?: boolean }[];
  };
  const changedFileIds = (data.changes ?? [])
    .filter((c) => !c.removed)
    .map((c) => c.fileId);
  // Google retorna newStartPageToken quando chegou ao fim da lista de mudanças
  const nextPageToken = data.newStartPageToken ?? data.nextPageToken ?? pageToken;
  return { changedFileIds, nextPageToken };
}

export async function createSharedVaultFile(
  token: GoogleToken,
  content: string,
  fileName: string
): Promise<string> {
  const headers = await authHeaders(token);
  const metadata = JSON.stringify({ name: fileName, mimeType: "application/octet-stream" });
  const boundary = "vault_share_" + crypto.randomUUID().replace(/-/g, "");
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    metadata,
    `--${boundary}`,
    "Content-Type: application/octet-stream",
    "",
    content,
    `--${boundary}--`,
  ].join("\r\n");

  const res = await rustFetch(
    "POST",
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    { ...headers, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  );
  if (!res.ok) throw new Error(`Erro ao criar arquivo compartilhado (${res.status}): ${res.text()}`);
  const data = res.json() as { id: string };
  return data.id;
}
