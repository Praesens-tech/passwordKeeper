import { create } from "zustand";
import { VaultData, PasswordEntry, PasswordGroup, GoogleToken, ViewMode, ActiveView, VaultPermission, DeletionRequest, SharedSource, SharedScopeType, SharedUser } from "../types/vault";
import { encryptData, decryptVaultEnvelope, encryptVaultEnvelope, createVaultDataKey, createVaultKeySlot, VaultKeySlot } from "../services/crypto";
import {
  findVaultFile,
  downloadVaultFile,
  uploadVaultFile,
  refreshAccessToken,
  getFileVersion,
  deleteDriveFile,
  getDriveChangesStartToken,
  listDriveChanges,
  createSharedVaultFile,
  shareFile,
} from "../services/googleDrive";
import {
  pickSavePath,
  pickOpenPath,
  writeVaultFile,
  readVaultFile,
  getMobileVaultPath,
} from "../services/localFile";
import { persistSave, persistLoad } from "../services/storage";

function generateId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

// ─── Sync persistence helpers (localStorage, for cold-start reads) ─────────────

function loadPersisted<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function savePersisted(key: string, value: unknown) {
  // Fire-and-forget: write to Tauri store (reliable) + localStorage (sync fallback)
  persistSave(key, value).catch(() => {});
}

function isRevokedDriveError(err: unknown): boolean {
  const msg = String(err);
  return (
    msg.includes("(404)") ||
    msg.includes("File not found") ||
    msg.includes("notFound") ||
    (msg.includes("(403)") && msg.includes("insufficientFilePermissions"))
  );
}

function isInsufficientScopeError(err: unknown): boolean {
  const msg = String(err);
  return (
    (msg.includes("(403)") && msg.includes("has not granted the app")) ||
    (msg.includes("(403)") && msg.includes("write access"))
  );
}

function toSharedGroupId(sourceId: string, localGroupId: string): string {
  return `shared:${sourceId}:group:${localGroupId}`;
}

function toSharedEntryId(sourceId: string, localEntryId: string): string {
  return `shared:${sourceId}:entry:${localEntryId}`;
}

interface VaultStore {
  // ── Auth / Lock state ──────────────────────────────────────────────────────
  isLocked: boolean;
  masterPassword: string;
  vaultDataKey: string | null;
  vaultKeySlots: VaultKeySlot[];

  // ── Google Drive ───────────────────────────────────────────────────────────
  googleToken: GoogleToken | null;
  driveFileId: string | null;
  driveRevision: string | null;
  driveChangesToken: string | null;
  userInfo: { email: string; name: string; picture: string } | null;

  // ── Local storage ──────────────────────────────────────────────────────────
  localVaultPath: string | null;

  // ── Vault data ─────────────────────────────────────────────────────────────
  vault: VaultData | null;
  sharedSources: SharedSource[];
  dismissedShareFileIds: string[];
  isDirty: boolean;
  isSyncing: boolean;
  lastSyncAt: string | null;
  syncError: string | null;

  // ── UI state ───────────────────────────────────────────────────────────────
  selectedGroupId: string | null;
  selectedEntryId: string | null;
  activeView: ActiveView;
  searchQuery: string;
  viewMode: ViewMode;

  // ── Auth ───────────────────────────────────────────────────────────────────
  setGoogleToken: (token: GoogleToken | null) => void;
  setUserInfo: (info: { email: string; name: string; picture: string } | null) => void;
  setDriveFileId: (id: string | null) => void;
  setDriveRevision: (revision: string | null) => void;
  setDriveChangesToken: (token: string | null) => void;
  initDriveChangesToken: () => Promise<void>;

  // ── Role ───────────────────────────────────────────────────────────────────
  currentUserRole: (scopeType?: SharedScopeType, scopeId?: string) => VaultPermission;
  canViewGroup: (groupId: string) => boolean;
  canEditGroup: (groupId: string) => boolean;
  canViewEntry: (entry: PasswordEntry) => boolean;
  canEditEntry: (entry: PasswordEntry) => boolean;

  // ── Storage init ───────────────────────────────────────────────────────────
  initFromStorage: () => Promise<void>;

  // ── Vault lifecycle ────────────────────────────────────────────────────────
  createVault: (masterPassword: string) => void;
  unlockVault: (encryptedData: string, masterPassword: string) => Promise<void>;
  lockVault: () => void;
  closeVault: () => void;
  getEncryptedVault: () => Promise<string>;
  addVaultPasswordSlot: (id: string, password: string) => Promise<void>;
  mergeSharedEntries: (entries: PasswordEntry[], group?: PasswordGroup | null) => void;
  mergeFromVault: (otherVault: VaultData) => number;
  addSharedSource: (fileId: string, sharedVault: VaultData, password: string, revision: string | null, openedEnvelope?: { dataKey: string | null; keySlots: import("../services/crypto").VaultKeySlot[] }) => void;
  refreshSharedSources: () => Promise<string | false>;
  syncSharedSource: (sourceId: string) => Promise<void>;
  syncOwnedSharedSourcesFromVault: () => void;
  removeSharedSource: (sourceId: string, cancelForEveryone?: boolean) => Promise<void>;
  dismissShareFile: (fileId: string) => void;

  // ── Local file ─────────────────────────────────────────────────────────────
  saveToLocalFile: (path?: string) => Promise<void>;
  persistLocalVaultPath: (path: string) => void;
  loadFromLocalFile: (path?: string) => Promise<string>;

  // ── Sync (Changes API) ─────────────────────────────────────────────────────
  pollDriveChanges: () => Promise<string | false>;
  syncToCloud: () => Promise<void>;
  loadFromCloud: () => Promise<string>;
  refreshFromCloudIfChanged: () => Promise<boolean>;
  ensureValidToken: () => Promise<GoogleToken>;
  forceSync: () => Promise<void>;
  clearSyncError: () => void;

  // ── Groups ─────────────────────────────────────────────────────────────────
  addGroup: (data: Omit<PasswordGroup, "id" | "createdAt" | "updatedAt">) => void;
  updateGroup: (id: string, data: Partial<PasswordGroup>) => void;
  deleteGroup: (id: string) => void;

  // ── Entries ────────────────────────────────────────────────────────────────
  addEntry: (data: Omit<PasswordEntry, "id" | "createdAt" | "updatedAt">) => void;
  updateEntry: (id: string, data: Partial<PasswordEntry>) => void;
  deleteEntry: (id: string) => void;
  toggleFavorite: (id: string) => void;

  // ── Deletion requests ──────────────────────────────────────────────────────
  requestDeletion: (entryId: string) => void;
  approveDeletion: (requestId: string) => void;
  rejectDeletion: (requestId: string) => void;

  // ── Sharing / permissions ──────────────────────────────────────────────────
  /**
   * Cria um arquivo colaborativo separado (pk-collab-<id>.keep) no Drive,
   * adiciona a SharedSource ao estado local, e compartilha o arquivo com o colaborador.
   * Retorna a sharePassword gerada para ser exibida ao usuário.
   */
  createSharedDocument: (params: {
    targetType: SharedScopeType;
    targetId: string | null;
    targetTitle: string;
    collaboratorEmail: string;
    collaboratorRole: VaultPermission;
    sharePassword: string;
  }) => Promise<void>;
  updateSharedUserRole: (email: string, role: VaultPermission, scopeType?: SharedScopeType, scopeId?: string, scopeTitle?: string) => void;
  removeSharedUser: (email: string, scopeType?: SharedScopeType, scopeId?: string) => void;

  // ── UI ─────────────────────────────────────────────────────────────────────
  selectGroup: (id: string | null) => void;
  selectEntry: (id: string | null) => void;
  setActiveView: (view: ActiveView) => void;
  setSearchQuery: (q: string) => void;
  setViewMode: (m: ViewMode) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;

  // ── Vault password ─────────────────────────────────────────────────────────
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;

  // ── Computed ───────────────────────────────────────────────────────────────
  getFilteredEntries: () => PasswordEntry[];
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  isLocked: true,
  masterPassword: "",
  vaultDataKey: null,
  vaultKeySlots: [],
  googleToken: loadPersisted<GoogleToken>("pk_google_token"),
  driveFileId: loadPersisted<string>("pk_drive_file_id"),
  driveRevision: loadPersisted<string>("pk_drive_revision"),
  driveChangesToken: loadPersisted<string>("pk_drive_changes_token"),
  userInfo: loadPersisted<{ email: string; name: string; picture: string }>("pk_user_info"),
  localVaultPath: loadPersisted<string>("pk_local_vault_path"),
  vault: null,
  sharedSources: [],
  dismissedShareFileIds: loadPersisted<string[]>("pk_dismissed_share_file_ids") ?? [],
  isDirty: false,
  isSyncing: false,
  lastSyncAt: null,
  syncError: null,
  selectedGroupId: null,
  selectedEntryId: null,
  activeView: "all",
  searchQuery: "",
  viewMode: "grid",
  sidebarOpen: !/android/i.test(navigator.userAgent),

  setGoogleToken: (token) => {
    const existing = get().googleToken;
    const next = token && existing?.refresh_token && !token.refresh_token
      ? { ...token, refresh_token: existing.refresh_token }
      : token;
    savePersisted("pk_google_token", next);
    set({ googleToken: next });
  },
  setUserInfo: (info) => {
    savePersisted("pk_user_info", info);
    set((s) => ({
      userInfo: info,
      vault: s.vault && !s.vault.owner && info
        ? { ...s.vault, owner: info.email }
        : s.vault,
    }));
  },
  setDriveFileId: (id) => {
    savePersisted("pk_drive_file_id", id);
    set({ driveFileId: id });
  },
  setDriveRevision: (revision) => {
    savePersisted("pk_drive_revision", revision);
    set({ driveRevision: revision });
  },

  setDriveChangesToken: (token) => {
    savePersisted("pk_drive_changes_token", token);
    set({ driveChangesToken: token });
  },

  initDriveChangesToken: async () => {
    const { driveChangesToken } = get();
    if (driveChangesToken) return; // já temos um token, não precisa buscar novo
    try {
      const authToken = await get().ensureValidToken();
      const changesToken = await getDriveChangesStartToken(authToken);
      savePersisted("pk_drive_changes_token", changesToken);
      set({ driveChangesToken: changesToken });
    } catch {
      // silencioso — o polling vai tentar de novo
    }
  },

  initFromStorage: async () => {
    const [googleToken, userInfo, driveFileId, driveRevision, driveChangesToken, localVaultPath] = await Promise.all([
      persistLoad<GoogleToken>("pk_google_token"),
      persistLoad<{ email: string; name: string; picture: string }>("pk_user_info"),
      persistLoad<string>("pk_drive_file_id"),
      persistLoad<string>("pk_drive_revision"),
      persistLoad<string>("pk_drive_changes_token"),
      persistLoad<string>("pk_local_vault_path"),
    ]);
    set((s) => ({
      googleToken: googleToken ?? s.googleToken,
      userInfo: userInfo ?? s.userInfo,
      driveFileId: driveFileId ?? s.driveFileId,
      driveRevision: driveRevision ?? s.driveRevision,
      driveChangesToken: driveChangesToken ?? s.driveChangesToken,
      localVaultPath: localVaultPath ?? s.localVaultPath,
    }));
  },

  currentUserRole: (scopeType, scopeId): VaultPermission => {
    const { vault, userInfo } = get();
    if (!vault) return "owner";
    if (!userInfo) return vault.collaboration ? "reader" : "owner";
    if (!vault.owner || vault.owner === userInfo.email) return "owner";

    const rank: Record<VaultPermission, number> = { reader: 1, editor: 2, owner: 3 };
    const best = (users: SharedUser[]) => users.reduce<VaultPermission | null>((acc, user) => {
      if (!acc || rank[user.role] > rank[acc]) return user.role;
      return acc;
    }, null);

    const shares = (vault.sharedWith ?? []).filter((u) => u.email === userInfo.email);
    if (!scopeType) return best(shares) ?? "reader";

    const matches = shares.filter((share) => {
      const shareScope = share.scopeType ?? "vault";
      if (shareScope === "vault") return true;
      if (shareScope === scopeType && share.scopeId === scopeId) return true;
      if (shareScope === "group" && scopeType === "entry") {
        const entry = vault.entries.find((item) => item.id === scopeId);
        return !!entry?.groupId && entry.groupId === share.scopeId;
      }
      return false;
    });

    return best(matches) ?? "reader";
  },

  canViewGroup: (groupId) => {
    const role = get().currentUserRole("group", groupId);
    if (role !== "reader") return true;
    const { vault, userInfo } = get();
    if (!vault || !userInfo || vault.owner === userInfo.email || !vault.owner) return true;
    return (vault.sharedWith ?? []).some((share) => {
      if (share.email !== userInfo.email) return false;
      const scope = share.scopeType ?? "vault";
      if (scope === "vault" || (scope === "group" && share.scopeId === groupId)) return true;
      if (scope === "entry") {
        const entry = vault.entries.find((item) => item.id === share.scopeId);
        return entry?.groupId === groupId;
      }
      return false;
    });
  },

  canEditGroup: (groupId) => {
    const role = get().currentUserRole("group", groupId);
    return role === "owner" || role === "editor";
  },

  canViewEntry: (entry) => {
    const role = get().currentUserRole("entry", entry.id);
    if (role !== "reader") return true;
    const { vault, userInfo } = get();
    if (!vault || !userInfo || vault.owner === userInfo.email || !vault.owner) return true;
    return (vault.sharedWith ?? []).some((share) => {
      if (share.email !== userInfo.email) return false;
      const scope = share.scopeType ?? "vault";
      return scope === "vault" ||
        (scope === "entry" && share.scopeId === entry.id) ||
        (scope === "group" && !!entry.groupId && share.scopeId === entry.groupId);
    });
  },

  canEditEntry: (entry) => {
    const role = get().currentUserRole("entry", entry.id);
    return role === "owner" || role === "editor";
  },

  createVault: (masterPassword) => {
    const vault: VaultData = {
      version: "1.0",
      owner: "",
      sharedWith: [],
      deletionRequests: [],
      groups: [],
      entries: [],
    };
    set({ vault, masterPassword, vaultDataKey: null, vaultKeySlots: [], isLocked: false, isDirty: true });
  },

  unlockVault: async (encryptedData, masterPassword) => {
    const opened = await decryptVaultEnvelope(encryptedData, masterPassword);
    const raw = JSON.parse(opened.plaintext);
    // Migrate older vaults that lack new fields
    const vault: VaultData = {
      sharedWith: [],
      deletionRequests: [],
      owner: "",
      ...raw,
    };
    set({
      vault,
      masterPassword,
      vaultDataKey: opened.dataKey,
      vaultKeySlots: opened.keySlots,
      isLocked: false,
      sharedSources: [],
    });
  },

  lockVault: () => {
    savePersisted("pk_drive_changes_token", null);
    set({
      isLocked: true,
      masterPassword: "",
      vaultDataKey: null,
      vaultKeySlots: [],
      vault: null,
      sharedSources: [],
      selectedEntryId: null,
      driveChangesToken: null,
    });
  },

  closeVault: () => {
    // Only clear vault-specific state — keep Google credentials so user
    // doesn't have to re-authenticate on the next open.
    savePersisted("pk_drive_file_id", null);
    savePersisted("pk_drive_revision", null);
    savePersisted("pk_local_vault_path", null);
    savePersisted("pk_drive_changes_token", null);
    set({
      isLocked: true,
      masterPassword: "",
      vault: null,
      vaultDataKey: null,
      vaultKeySlots: [],
      sharedSources: [],
      selectedEntryId: null,
      selectedGroupId: null,
      activeView: "all",
      searchQuery: "",
      localVaultPath: null,
      driveFileId: null,
      driveRevision: null,
      driveChangesToken: null,
      syncError: null,
      isDirty: false,
    });
  },

  mergeSharedEntries: (entries, group) => {
    const { userInfo } = get();
    set((s) => {
      if (!s.vault) return s;
      let groups = s.vault.groups;
      let targetGroupId: string | undefined;

      // If the share included a group, add it (or reuse existing by name)
      if (group) {
        const existing = groups.find((g) => g.name === group.name);
        if (existing) {
          targetGroupId = existing.id;
        } else {
          const newGroup: PasswordGroup = { ...group, id: generateId(), createdAt: now(), updatedAt: now() };
          groups = [...groups, newGroup];
          targetGroupId = newGroup.id;
        }
      }

      // Add entries, skipping any already existing (by username+name match)
      const newEntries = entries
        .filter((e) => !s.vault!.entries.some((ex) => ex.name === e.name && ex.username === e.username))
        .map((e) => ({
          ...e,
          id: generateId(),
          groupId: targetGroupId ?? e.groupId,
          createdBy: userInfo?.email,
          createdAt: now(),
          updatedAt: now(),
        }));

      return {
        vault: { ...s.vault, groups, entries: [...s.vault.entries, ...newEntries] },
        isDirty: true,
      };
    });
  },

  mergeFromVault: (otherVault) => {
    let newEntriesCount = 0;
    set((s) => {
      if (!s.vault) return s;

      // Map group IDs from the other vault → this vault (match by name)
      const groupIdMap = new Map<string, string>();
      let groups = [...s.vault.groups];
      for (const g of (otherVault.groups ?? [])) {
        const existing = groups.find((eg) => eg.name === g.name);
        if (existing) {
          groupIdMap.set(g.id, existing.id);
        } else {
          const newGroup: PasswordGroup = { ...g, id: generateId(), createdAt: now(), updatedAt: now() };
          groups = [...groups, newGroup];
          groupIdMap.set(g.id, newGroup.id);
        }
      }

      const incoming = (otherVault.entries ?? [])
        .filter((e) => !s.vault!.entries.some((ex) => ex.name === e.name && ex.username === e.username))
        .map((e) => ({
          ...e,
          id: generateId(),
          groupId: e.groupId ? (groupIdMap.get(e.groupId) ?? undefined) : undefined,
          createdAt: now(),
          updatedAt: now(),
        }));
      newEntriesCount = incoming.length;

      if (incoming.length === 0 && groups.length === s.vault.groups.length) return s;
      return {
        vault: { ...s.vault, groups, entries: [...s.vault.entries, ...incoming] },
        isDirty: incoming.length > 0,
      };
    });
    return newEntriesCount;
  },

  addSharedSource: (fileId, sharedVault, password, revision, openedEnvelope) => {
    const sourceId = sharedVault.collaboration?.documentId || fileId;
    const owner = sharedVault.owner || "Compartilhado";
    const { userInfo } = get();
    const role = sharedVault.owner === userInfo?.email
      ? "owner"
      : sharedVault.sharedWith?.find((u) => u.email === userInfo?.email)?.role
        ?? sharedVault.sharedWith?.[0]?.role
        ?? "reader";
    const groups = (sharedVault.groups ?? []).map((group) => ({
      ...group,
      id: `shared:${sourceId}:group:${group.id}`,
      sourceGroupId: group.id,
      sharedSourceId: sourceId,
    }));
    const entries = (sharedVault.entries ?? []).map((entry) => ({
      ...entry,
      id: `shared:${sourceId}:entry:${entry.id}`,
      sourceEntryId: entry.id,
      sharedSourceId: sourceId,
      groupId: entry.groupId ? `shared:${sourceId}:group:${entry.groupId}` : undefined,
    }));
    const remoteEntriesById = new Map(entries.map((entry) => [entry.sourceEntryId ?? entry.id, entry]));
    const remoteGroupsById = new Map(groups.map((group) => [group.sourceGroupId ?? group.id, group]));
    set((s) => {
      let newVault = s.vault;
      let isDirty = s.isDirty;

      if (role === "owner" && s.vault) {
        const existingEntryIds = new Set(s.vault.entries.map((e) => e.id));

        // Update entries that exist in both local vault and remote
        let anyUpdated = false;
        const updatedEntries = s.vault.entries.map((entry) => {
          const remote = remoteEntriesById.get(entry.id);
          if (!remote) return entry;
          const { id, sourceEntryId, sharedSourceId, groupId, ...data } = remote;
          const merged = { ...entry, ...data };
          if (merged.updatedAt !== entry.updatedAt) anyUpdated = true;
          return merged;
        });

        // Add entries created by collaborators that don't exist in the local vault yet
        const newEntries = entries
          .filter((e) => e.sourceEntryId != null && !existingEntryIds.has(e.sourceEntryId))
          .map(({ id, sourceEntryId, sharedSourceId, groupId, ...data }) => ({
            ...data,
            id: sourceEntryId!,
            groupId: groupId?.startsWith(`shared:${sourceId}:group:`)
              ? groupId.replace(`shared:${sourceId}:group:`, "")
              : groupId,
          }));

        const updatedGroups = s.vault.groups.map((group) => {
          const remote = remoteGroupsById.get(group.id);
          if (!remote) return group;
          const { id, sourceGroupId, sharedSourceId, ...data } = remote;
          return { ...group, ...data };
        });

        if (newEntries.length > 0 || anyUpdated) isDirty = true;

        newVault = {
          ...s.vault,
          groups: updatedGroups,
          entries: [...updatedEntries, ...newEntries],
        };
      }

      return {
        dismissedShareFileIds: s.dismissedShareFileIds.filter((id) => id !== fileId),
        vault: newVault,
        isDirty,
        sharedSources: [
          ...s.sharedSources.filter((source) => source.id !== sourceId && source.fileId !== fileId),
          {
            id: sourceId,
            fileId,
            name: sharedVault.collaboration?.title || "Compartilhamento",
            owner,
            role,
            collaboration: sharedVault.collaboration,
            sharedWith: sharedVault.sharedWith ?? [],
            password,
            dataKey: openedEnvelope?.dataKey ?? null,
            keySlots: openedEnvelope?.keySlots ?? [],
            revision,
            lastSyncAt: now(),
            updatedBy: owner,
            updatedAt: now(),
            groups,
            entries,
          },
        ],
      };
    });
  },

  // Mantido por compatibilidade com forceSync — delega para pollDriveChanges
  refreshSharedSources: async () => {
    return get().pollDriveChanges();
  },

  /**
   * Usa a Drive Changes API para detectar quais arquivos mudaram desde a última
   * verificação. Só baixa e decripta os arquivos que realmente mudaram.
   * Muito mais eficiente que verificar a revisão de cada arquivo individualmente.
   */
  pollDriveChanges: async () => {
    const { sharedSources, driveFileId, driveChangesToken } = get();
    const hasAnything = sharedSources.length > 0 || !!driveFileId;
    if (!hasAnything) return false;

    let authToken: GoogleToken;
    try {
      authToken = await get().ensureValidToken();
    } catch {
      return false;
    }

    // Se não temos changesToken, obter um agora e sair (na próxima rodada detectamos mudanças)
    if (!driveChangesToken) {
      await get().initDriveChangesToken();
      return false;
    }

    let changedFileIds: string[];
    let nextPageToken: string;
    try {
      ({ changedFileIds, nextPageToken } = await listDriveChanges(authToken, driveChangesToken));
    } catch {
      return false;
    }

    // Persistir o próximo token mesmo que não haja mudanças relevantes
    if (nextPageToken !== driveChangesToken) {
      savePersisted("pk_drive_changes_token", nextPageToken);
      set({ driveChangesToken: nextPageToken });
    }

    if (changedFileIds.length === 0) return false;

    let notice: string | false = false;

    // ── Verificar cofre principal ────────────────────────────────────────────
    if (driveFileId && changedFileIds.includes(driveFileId)) {
      const didUpdate = await get().refreshFromCloudIfChanged();
      if (didUpdate) notice = "Cofre principal atualizado";
    }

    // ── Verificar fontes compartilhadas ──────────────────────────────────────
    for (const source of sharedSources) {
      if (!changedFileIds.includes(source.fileId)) continue;
      try {
        const encrypted = await downloadVaultFile(authToken, source.fileId);
        // decryptVaultEnvelope suporta tanto v2 (envelope multi-slot) quanto legado
        const opened = await decryptVaultEnvelope(encrypted, source.password);
        const remoteData = JSON.parse(opened.plaintext) as VaultData;
        const revision = await getFileVersion(authToken, source.fileId);
        get().addSharedSource(source.fileId, remoteData, source.password, revision, {
          dataKey: opened.dataKey,
          keySlots: opened.keySlots,
        });
        const displayName = remoteData.owner || source.owner;
        notice = `"${source.name}" atualizado por ${displayName}`;
      } catch (err) {
        if (isRevokedDriveError(err)) {
          set((s) => ({
            sharedSources: s.sharedSources.filter((item) => item.id !== source.id),
            selectedEntryId: s.selectedEntryId?.includes(`shared:${source.id}:`) ? null : s.selectedEntryId,
            selectedGroupId: s.selectedGroupId?.includes(`shared:${source.id}:`) ? null : s.selectedGroupId,
            activeView: s.selectedGroupId?.includes(`shared:${source.id}:`) ? "all" : s.activeView,
          }));
          notice = `Compartilhamento removido: ${source.name}`;
        }
        // outros erros: ignorar silenciosamente para não interromper o loop
      }
    }

    return notice;
  },

  syncOwnedSharedSourcesFromVault: () => {
    const { vault, sharedSources } = get();
    if (!vault) return;

    const ownedSources = sharedSources.filter((source) => source.role === "owner" && source.collaboration);
    if (ownedSources.length === 0) return;

    const groupById = new Map(vault.groups.map((group) => [group.id, group]));
    const nextSources = sharedSources.map((source) => {
      if (source.role !== "owner" || !source.collaboration) return source;

      const { type, createdFromId } = source.collaboration;
      let groups: PasswordGroup[] = [];
      let entries: PasswordEntry[] = [];

      if (type === "vault") {
        groups = vault.groups.map((group) => ({
          ...group,
          id: toSharedGroupId(source.id, group.id),
          sourceGroupId: group.id,
          sharedSourceId: source.id,
        }));
        entries = vault.entries.map((entry) => ({
          ...entry,
          id: toSharedEntryId(source.id, entry.id),
          sourceEntryId: entry.id,
          sharedSourceId: source.id,
          groupId: entry.groupId ? toSharedGroupId(source.id, entry.groupId) : undefined,
        }));
      } else if (type === "group" && createdFromId) {
        const group = groupById.get(createdFromId);
        if (group) {
          groups = [{
            ...group,
            id: toSharedGroupId(source.id, group.id),
            sourceGroupId: group.id,
            sharedSourceId: source.id,
          }];
        }
        entries = vault.entries
          .filter((entry) => entry.groupId === createdFromId)
          .map((entry) => ({
            ...entry,
            id: toSharedEntryId(source.id, entry.id),
            sourceEntryId: entry.id,
            sharedSourceId: source.id,
            groupId: toSharedGroupId(source.id, createdFromId),
          }));
      } else if (type === "entry" && createdFromId) {
        const entry = vault.entries.find((item) => item.id === createdFromId);
        if (entry) {
          entries = [{
            ...entry,
            id: toSharedEntryId(source.id, entry.id),
            sourceEntryId: entry.id,
            sharedSourceId: source.id,
            groupId: undefined,
          }];
        }
      }

      return { ...source, groups, entries, updatedAt: now(), updatedBy: get().userInfo?.email ?? source.updatedBy };
    });

    set({ sharedSources: nextSources });
    ownedSources.forEach((source) => {
      get().syncSharedSource(source.id).catch((err) => set({ syncError: String(err) }));
    });
  },

  syncSharedSource: async (sourceId) => {
    const source = get().sharedSources.find((item) => item.id === sourceId);
    if (!source || source.role === "reader") return;
    const token = await get().ensureValidToken();
    const groups = source.groups.map(({ sourceGroupId, sharedSourceId, ...group }) => ({
      ...group,
      id: sourceGroupId ?? group.id,
    }));
    const entries = source.entries.map(({ sourceEntryId, sharedSourceId, groupId, ...entry }) => ({
      ...entry,
      id: sourceEntryId ?? entry.id,
      groupId: groupId?.startsWith(`shared:${source.id}:group:`)
        ? groupId.replace(`shared:${source.id}:group:`, "")
        : groupId,
      updatedAt: now(),
    }));
    const sharedVault: VaultData = {
      version: "1.0",
      owner: source.owner,
      collaboration: source.collaboration ?? {
        documentId: source.id,
        type: "vault",
        title: source.name,
        createdAt: source.updatedAt ?? now(),
      },
      sharedWith: source.sharedWith,
      deletionRequests: [],
      groups,
      entries,
    };

    // Usar envelope v2 com os keySlots existentes (preserva senhas de todos os colaboradores).
    // Se não temos keySlots (arquivo criado no formato legado), fazer fallback para encryptData.
    let encrypted: string;
    if (source.dataKey && source.keySlots && source.keySlots.length > 0) {
      encrypted = await encryptVaultEnvelope(JSON.stringify(sharedVault), source.dataKey, source.keySlots);
    } else {
      encrypted = await encryptData(JSON.stringify(sharedVault), source.password);
    }

    await uploadVaultFile(token, encrypted, source.fileId);
    const revision = await getFileVersion(token, source.fileId);
    set((s) => ({
      sharedSources: s.sharedSources.map((item) => item.id === sourceId
        ? { ...item, revision, lastSyncAt: now(), updatedBy: get().userInfo?.email, updatedAt: now() }
        : item),
    }));
  },

  removeSharedSource: async (sourceId, cancelForEveryone = false) => {
    const source = get().sharedSources.find((item) => item.id === sourceId);
    if (!source) return;
    if (cancelForEveryone) {
      if (source.role !== "owner") throw new Error("Apenas o proprietário pode cancelar para todos.");
      const token = await get().ensureValidToken();
      await deleteDriveFile(token, source.fileId);
    }
    set((s) => ({
      dismissedShareFileIds: Array.from(new Set([...s.dismissedShareFileIds, source.fileId])),
      sharedSources: s.sharedSources.filter((item) => item.id !== sourceId),
      selectedEntryId: s.selectedEntryId?.includes(`shared:${sourceId}:`) ? null : s.selectedEntryId,
      selectedGroupId: s.selectedGroupId?.includes(`shared:${sourceId}:`) ? null : s.selectedGroupId,
      activeView: s.selectedGroupId?.includes(`shared:${sourceId}:`) ? "all" : s.activeView,
    }));
    savePersisted("pk_dismissed_share_file_ids", get().dismissedShareFileIds);
  },

  dismissShareFile: (fileId) => {
    set((s) => {
      const dismissedShareFileIds = Array.from(new Set([...s.dismissedShareFileIds, fileId]));
      savePersisted("pk_dismissed_share_file_ids", dismissedShareFileIds);
      return { dismissedShareFileIds };
    });
  },

  getEncryptedVault: async () => {
    const { vault, masterPassword } = get();
    if (!vault || !masterPassword) throw new Error("Cofre não está desbloqueado");

    let dataKey = get().vaultDataKey;
    let keySlots = get().vaultKeySlots;

    if (!dataKey) dataKey = createVaultDataKey();
    if (!keySlots.some((slot) => slot.id === "master")) {
      keySlots = [await createVaultKeySlot("master", masterPassword, dataKey), ...keySlots];
    }

    set({ vaultDataKey: dataKey, vaultKeySlots: keySlots });
    return encryptVaultEnvelope(JSON.stringify(vault), dataKey, keySlots);
  },

  addVaultPasswordSlot: async (id, password) => {
    if (!password) throw new Error("Senha de compartilhamento obrigatória");
    let dataKey = get().vaultDataKey;
    if (!dataKey) {
      await get().getEncryptedVault();
      dataKey = get().vaultDataKey;
    }
    if (!dataKey) throw new Error("Não foi possível preparar a chave do cofre");

    const slot = await createVaultKeySlot(id, password, dataKey);
    set((s) => ({
      vaultKeySlots: [slot, ...s.vaultKeySlots.filter((item) => item.id !== id)],
      isDirty: true,
    }));
  },

  // ── Local file ────────────────────────────────────────────────────────────

  saveToLocalFile: async (path) => {
    set({ isSyncing: true, syncError: null });
    try {
      let savePath = path ?? get().localVaultPath;
      if (!savePath) {
        savePath = /android/i.test(navigator.userAgent)
          ? await getMobileVaultPath()
          : await pickSavePath("meu-cofre.keep");
        if (!savePath) { set({ isSyncing: false }); return; }
      }
      const encrypted = await get().getEncryptedVault();
      await writeVaultFile(savePath, encrypted);
      savePersisted("pk_local_vault_path", savePath);
      set({ localVaultPath: savePath, isDirty: false, lastSyncAt: now(), isSyncing: false });
    } catch (err) {
      set({ syncError: String(err), isSyncing: false });
      throw err;
    }
  },

  // Persiste apenas o path sem reescrever o arquivo (usado após abrir um cofre existente)
  persistLocalVaultPath: (path: string) => {
    savePersisted("pk_local_vault_path", path);
    set({ localVaultPath: path });
  },

  loadFromLocalFile: async (path) => {
    set({ isSyncing: true, syncError: null });
    try {
      let loadPath: string | null | undefined = path;
      if (!loadPath) {
        loadPath = /android/i.test(navigator.userAgent)
          ? (get().localVaultPath ?? await getMobileVaultPath())
          : await pickOpenPath();
        if (!loadPath) { set({ isSyncing: false }); throw new Error("Nenhum arquivo selecionado"); }
      }
      const encrypted = await readVaultFile(loadPath);
      savePersisted("pk_local_vault_path", loadPath);
      set({ localVaultPath: loadPath, isSyncing: false });
      return encrypted;
    } catch (err) {
      set({ syncError: String(err), isSyncing: false });
      throw err;
    }
  },

  // ── Google Drive ──────────────────────────────────────────────────────────

  ensureValidToken: async () => {
    const { googleToken } = get();
    if (!googleToken) throw new Error("Não autenticado com o Google");
    if (Date.now() < googleToken.expires_at - 60000) return googleToken;
    // Token expired — try silent refresh before asking user to log in again
    if (!googleToken.refresh_token) throw new Error("Sessão expirada, faça login novamente");
    const newToken = await refreshAccessToken(googleToken.refresh_token, googleToken.client_id);
    get().setGoogleToken(newToken);
    return newToken;
  },

  clearSyncError: () => set({ syncError: null }),

  forceSync: async () => {
    const { googleToken, localVaultPath, isDirty, vault } = get();
    const isAndroid = /android/i.test(navigator.userAgent);
    // Block syncToCloud only when the vault OWNER opens a collab file as main vault.
    // Editors open with the share password as masterPassword, so their syncToCloud is correct.
    const isOwnerOfCollabVault = !!vault?.collaboration && get().currentUserRole() === "owner";
    set({ syncError: null });
    try {
      if (isDirty && !isOwnerOfCollabVault) {
        if (localVaultPath || isAndroid) await get().saveToLocalFile(localVaultPath ?? undefined);
        if (googleToken) await get().syncToCloud();
      }
      // Propagate owner's vault changes to all owned shared sources
      get().syncOwnedSharedSourcesFromVault();
      // Retry any writable received shared sources (editor role)
      const writables = get().sharedSources.filter((s) => s.role !== "reader");
      for (const source of writables) {
        await get().syncSharedSource(source.id);
      }
      // Pull latest from all shared sources
      await get().refreshSharedSources();
    } catch (err) {
      if (isInsufficientScopeError(err)) {
        get().setGoogleToken(null);
        set({ syncError: "Permissões do Google Drive desatualizadas. Vá em Arquivo → Google Drive e reconecte sua conta." });
      } else {
        set({ syncError: String(err) });
      }
    }
  },

  syncToCloud: async () => {
    set({ isSyncing: true, syncError: null });
    try {
      const token = await get().ensureValidToken();
      const { driveFileId } = get();
      const encrypted = await get().getEncryptedVault();
      const newFileId = await uploadVaultFile(token, encrypted, driveFileId ?? undefined);
      const revision = await getFileVersion(token, newFileId);
      savePersisted("pk_drive_revision", revision);
      savePersisted("pk_drive_file_id", newFileId);
      set({ driveFileId: newFileId, driveRevision: revision, isDirty: false, lastSyncAt: now(), isSyncing: false });
    } catch (err) {
      set({ syncError: String(err), isSyncing: false });
      throw err;
    }
  },

  loadFromCloud: async () => {
    set({ isSyncing: true, syncError: null });
    try {
      const token = await get().ensureValidToken();
      let fileId = get().driveFileId;
      if (!fileId) {
        fileId = await findVaultFile(token);
        if (!fileId) throw new Error("Nenhum cofre encontrado no Drive");
        set({ driveFileId: fileId });
      }
      const encrypted = await downloadVaultFile(token, fileId);
      const revision = await getFileVersion(token, fileId);
      savePersisted("pk_drive_revision", revision);
      set({ driveRevision: revision, isSyncing: false });
      return encrypted;
    } catch (err) {
      set({ syncError: String(err), isSyncing: false });
      throw err;
    }
  },

  refreshFromCloudIfChanged: async () => {
    const { isLocked, isDirty, masterPassword, driveFileId, driveRevision } = get();
    if (isLocked || isDirty || !masterPassword || !driveFileId) return false;
    const token = await get().ensureValidToken();
    const revision = await getFileVersion(token, driveFileId);
    if (!revision || revision === driveRevision) return false;
    const encrypted = await downloadVaultFile(token, driveFileId);
    const opened = await decryptVaultEnvelope(encrypted, masterPassword);
    const raw = JSON.parse(opened.plaintext);
    const vault: VaultData = {
      sharedWith: [],
      deletionRequests: [],
      owner: "",
      ...raw,
    };
    savePersisted("pk_drive_revision", revision);
    set({
      vault,
      vaultDataKey: opened.dataKey,
      vaultKeySlots: opened.keySlots,
      driveRevision: revision,
      lastSyncAt: now(),
      syncError: null,
    });
    return true;
  },

  addGroup: (data) => {
    if (get().currentUserRole("vault") === "reader") return;
    const group: PasswordGroup = { ...data, id: generateId(), createdAt: now(), updatedAt: now() };
    set((s) => ({
      vault: s.vault ? { ...s.vault, groups: [...s.vault.groups, group] } : s.vault,
      isDirty: true,
    }));
    get().syncOwnedSharedSourcesFromVault();
  },

  updateGroup: (id, data) => {
    if (!get().canEditGroup(id)) return;
    set((s) => ({
      vault: s.vault
        ? { ...s.vault, groups: s.vault.groups.map((g) => g.id === id ? { ...g, ...data, updatedAt: now() } : g) }
        : s.vault,
      isDirty: true,
    }));
    get().syncOwnedSharedSourcesFromVault();
  },

  deleteGroup: (id) => {
    if (get().currentUserRole("group", id) !== "owner") return;
    set((s) => ({
      vault: s.vault
        ? {
            ...s.vault,
            groups: s.vault.groups.filter((g) => g.id !== id),
            entries: s.vault.entries.map((e) => e.groupId === id ? { ...e, groupId: undefined, updatedAt: now() } : e),
          }
        : s.vault,
      selectedGroupId: s.selectedGroupId === id ? null : s.selectedGroupId,
      isDirty: true,
    }));
    get().syncOwnedSharedSourcesFromVault();
  },

  addEntry: (data) => {
    if (data.groupId) {
      if (!get().canEditGroup(data.groupId)) return;
    } else if (get().currentUserRole("vault") === "reader") return;
    if (data.groupId?.startsWith("shared:")) {
      const sourceId = data.groupId.split(":")[1];
      const source = get().sharedSources.find((item) => item.id === sourceId);
      if (!source || source.role === "reader") return;
      const remoteId = generateId();
      const { userInfo } = get();
      const entry: PasswordEntry = {
        ...data,
        id: `shared:${sourceId}:entry:${remoteId}`,
        sourceEntryId: remoteId,
        sharedSourceId: sourceId,
        createdBy: userInfo?.email,
        createdAt: now(),
        updatedAt: now(),
      };
      set((s) => ({
        sharedSources: s.sharedSources.map((item) => item.id === sourceId
          ? { ...item, entries: [...item.entries, entry] }
          : item),
      }));
      get().syncSharedSource(sourceId).catch((err) => set({ syncError: String(err) }));
      return;
    }
    const { userInfo } = get();
    const entry: PasswordEntry = {
      ...data,
      id: generateId(),
      createdBy: userInfo?.email,
      createdAt: now(),
      updatedAt: now(),
    };
    set((s) => ({
      vault: s.vault ? { ...s.vault, entries: [...s.vault.entries, entry] } : s.vault,
      isDirty: true,
    }));
    get().syncOwnedSharedSourcesFromVault();
  },

  updateEntry: (id, data) => {
    const localEntry = get().vault?.entries.find((entry) => entry.id === id);
    if (localEntry && !get().canEditEntry(localEntry)) return;
    if (id.startsWith("shared:")) {
      const sourceId = id.split(":")[1];
      const source = get().sharedSources.find((item) => item.id === sourceId);
      if (!source || source.role === "reader") return;
      set((s) => ({
        sharedSources: s.sharedSources.map((item) => item.id === sourceId
          ? { ...item, entries: item.entries.map((e) => e.id === id ? { ...e, ...data, updatedAt: now() } : e) }
          : item),
      }));
      get().syncSharedSource(sourceId).catch((err) => set({ syncError: String(err) }));
      return;
    }
    set((s) => ({
      vault: s.vault
        ? { ...s.vault, entries: s.vault.entries.map((e) => e.id === id ? { ...e, ...data, updatedAt: now() } : e) }
        : s.vault,
      isDirty: true,
    }));
    get().syncOwnedSharedSourcesFromVault();
  },

  deleteEntry: (id) => {
    const localEntry = get().vault?.entries.find((entry) => entry.id === id);
    if (localEntry && get().currentUserRole("entry", id) !== "owner") return;
    if (id.startsWith("shared:")) {
      const sourceId = id.split(":")[1];
      const source = get().sharedSources.find((item) => item.id === sourceId);
      if (!source || source.role !== "owner") return;
      set((s) => ({
        sharedSources: s.sharedSources.map((item) => item.id === sourceId
          ? { ...item, entries: item.entries.filter((e) => e.id !== id) }
          : item),
        selectedEntryId: s.selectedEntryId === id ? null : s.selectedEntryId,
      }));
      get().syncSharedSource(sourceId).catch((err) => set({ syncError: String(err) }));
      return;
    }
    set((s) => ({
      vault: s.vault ? { ...s.vault, entries: s.vault.entries.filter((e) => e.id !== id) } : s.vault,
      selectedEntryId: s.selectedEntryId === id ? null : s.selectedEntryId,
      isDirty: true,
    }));
    get().syncOwnedSharedSourcesFromVault();
  },

  toggleFavorite: (id) => {
    const localEntry = get().vault?.entries.find((entry) => entry.id === id);
    if (localEntry && !get().canEditEntry(localEntry)) return;
    if (id.startsWith("shared:")) {
      const sourceId = id.split(":")[1];
      const source = get().sharedSources.find((item) => item.id === sourceId);
      if (!source || source.role === "reader") return;
      set((s) => ({
        sharedSources: s.sharedSources.map((item) => item.id === sourceId
          ? { ...item, entries: item.entries.map((e) => e.id === id ? { ...e, favorite: !e.favorite, updatedAt: now() } : e) }
          : item),
      }));
      get().syncSharedSource(sourceId).catch((err) => set({ syncError: String(err) }));
      return;
    }
    set((s) => ({
      vault: s.vault
        ? { ...s.vault, entries: s.vault.entries.map((e) => e.id === id ? { ...e, favorite: !e.favorite, updatedAt: now() } : e) }
        : s.vault,
      isDirty: true,
    }));
    get().syncOwnedSharedSourcesFromVault();
  },

  requestDeletion: (entryId) => {
    const { vault, userInfo } = get();
    if (!vault) return;
    const entry = vault.entries.find((e) => e.id === entryId);
    if (!entry) return;
    const request: DeletionRequest = {
      id: generateId(),
      entryId,
      entryName: entry.name,
      requestedBy: userInfo?.email ?? "Desconhecido",
      requestedAt: now(),
    };
    set((s) => ({
      vault: s.vault
        ? { ...s.vault, deletionRequests: [...(s.vault.deletionRequests ?? []), request] }
        : s.vault,
      isDirty: true,
    }));
  },

  approveDeletion: (requestId) => {
    if (get().currentUserRole() !== "owner") return;
    set((s) => {
      if (!s.vault) return s;
      const req = (s.vault.deletionRequests ?? []).find((r) => r.id === requestId);
      if (!req) return s;
      return {
        vault: {
          ...s.vault,
          entries: s.vault.entries.filter((e) => e.id !== req.entryId),
          deletionRequests: s.vault.deletionRequests.filter((r) => r.id !== requestId),
        },
        selectedEntryId: s.selectedEntryId === req.entryId ? null : s.selectedEntryId,
        isDirty: true,
      };
    });
  },

  rejectDeletion: (requestId) => {
    set((s) => ({
      vault: s.vault
        ? { ...s.vault, deletionRequests: (s.vault.deletionRequests ?? []).filter((r) => r.id !== requestId) }
        : s.vault,
      isDirty: true,
    }));
  },

  createSharedDocument: async ({ targetType, targetId, targetTitle, collaboratorEmail, collaboratorRole, sharePassword }) => {
    const { vault, userInfo } = get();
    if (!vault) throw new Error("Cofre não está desbloqueado");
    if (!sharePassword) throw new Error("Senha de compartilhamento é obrigatória");

    const token = await get().ensureValidToken();
    const collaborator = collaboratorEmail.trim().toLowerCase();
    const documentId = generateId();
    const fileName = `pk-collab-${documentId}.keep`;

    // ── Montar VaultData do documento compartilhado ────────────────────────
    const collaboration = {
      documentId,
      type: targetType,
      title: targetTitle,
      createdFromId: targetId ?? undefined,
      createdAt: now(),
    };

    let groups: PasswordGroup[] = [];
    let entries: PasswordEntry[] = [];

    if (targetType === "vault") {
      groups = vault.groups;
      entries = vault.entries;
    } else if (targetType === "group" && targetId) {
      const group = vault.groups.find((g) => g.id === targetId);
      if (group) groups = [group];
      entries = vault.entries.filter((e) => e.groupId === targetId);
    } else if (targetType === "entry" && targetId) {
      const entry = vault.entries.find((e) => e.id === targetId);
      if (entry) entries = [entry];
    }

    const sharedVault: VaultData = {
      version: "1.0",
      owner: userInfo?.email ?? vault.owner,
      collaboration,
      sharedWith: [{ email: collaborator, role: collaboratorRole, scopeType: targetType, scopeId: targetId ?? undefined, scopeTitle: targetTitle, addedAt: now() }],
      deletionRequests: [],
      groups,
      entries,
    };

    // ── Criptografar com envelope v2 (multi-slot: owner + collaborator) ────
    const dataKey = createVaultDataKey();
    const ownerPassword = get().masterPassword;
    const [ownerSlot, collabSlot] = await Promise.all([
      createVaultKeySlot("owner", ownerPassword, dataKey),
      createVaultKeySlot(`collab:${collaborator}`, sharePassword, dataKey),
    ]);
    const keySlots: VaultKeySlot[] = [ownerSlot, collabSlot];
    const encrypted = await encryptVaultEnvelope(JSON.stringify(sharedVault), dataKey, keySlots);

    // ── Fazer upload do arquivo colaborativo ─────────────────────────────
    const fileId = await createSharedVaultFile(token, encrypted, fileName);

    // ── Compartilhar via Drive API ────────────────────────────────────────
    await shareFile(
      token,
      fileId,
      collaborator,
      collaboratorRole === "reader" ? "reader" : "writer",
      `Você recebeu acesso ao cofre de senhas "${targetTitle}". Abra o app Password Keeper e use a opção "Abrir compartilhamento" com a senha fornecida pelo proprietário.`,
    );

    // ── Registrar SharedSource no estado local (proprietário) ─────────────
    const revision = await getFileVersion(token, fileId);
    get().addSharedSource(fileId, sharedVault, ownerPassword, revision, { dataKey, keySlots });

    // ── Inicializar changesToken se ainda não temos ────────────────────────
    await get().initDriveChangesToken();
  },

  updateSharedUserRole: (email, role, scopeType = "vault", scopeId, scopeTitle) => {
    if (get().currentUserRole() !== "owner") return;
    const normalizedEmail = email.trim().toLowerCase();
    set((s) => {
      if (!s.vault) return s;
      const sameGrant = (u: SharedUser) =>
        u.email === normalizedEmail &&
        (u.scopeType ?? "vault") === scopeType &&
        (u.scopeId ?? "") === (scopeId ?? "");
      const existing = s.vault.sharedWith.find(sameGrant);
      const sharedWith = existing
        ? s.vault.sharedWith.map((u) => sameGrant(u) ? { ...u, role, scopeType, scopeId, scopeTitle } : u)
        : [...s.vault.sharedWith, { email: normalizedEmail, role, scopeType, scopeId, scopeTitle, addedAt: now() }];
      return { vault: { ...s.vault, sharedWith }, isDirty: true };
    });
  },

  removeSharedUser: (email, scopeType, scopeId) => {
    if (get().currentUserRole() !== "owner") return;
    const normalizedEmail = email.trim().toLowerCase();
    set((s) => ({
      vault: s.vault
        ? {
            ...s.vault,
            sharedWith: s.vault.sharedWith.filter((u) => {
              if (u.email !== normalizedEmail) return true;
              if (!scopeType) return false;
              return (u.scopeType ?? "vault") !== scopeType || (u.scopeId ?? "") !== (scopeId ?? "");
            }),
          }
        : s.vault,
      isDirty: true,
    }));
  },

  selectGroup: (id) => set({ selectedGroupId: id, selectedEntryId: null, activeView: id ? "group" : "all" }),
  selectEntry: (id) => set({ selectedEntryId: id }),
  setActiveView: (view) => set({ activeView: view, selectedGroupId: null, selectedEntryId: null }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setViewMode: (m) => set({ viewMode: m }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  changePassword: async (currentPassword, newPassword) => {
    const { masterPassword, vault, userInfo } = get();
    if (vault?.owner && userInfo?.email !== vault.owner) throw new Error("Apenas o proprietário pode trocar a senha mestra do cofre");
    if (currentPassword !== masterPassword) throw new Error("Senha atual incorreta");
    let dataKey = get().vaultDataKey;
    if (!dataKey) dataKey = createVaultDataKey();
    const masterSlot = await createVaultKeySlot("master", newPassword, dataKey);
    set((s) => ({
      masterPassword: newPassword,
      vaultDataKey: dataKey,
      vaultKeySlots: [masterSlot, ...s.vaultKeySlots.filter((slot) => slot.id !== "master")],
      isDirty: true,
    }));
  },

  getFilteredEntries: () => {
    const { vault, activeView, selectedGroupId, searchQuery, sharedSources } = get();
    if (!vault) return [];
    let entries = [
      ...vault.entries.filter((entry) => get().canViewEntry(entry)),
      ...sharedSources.filter((source) => source.role !== "owner").flatMap((source) => source.entries),
    ];
    if (activeView === "favorites") entries = entries.filter((e) => e.favorite);
    else if (activeView === "group" && selectedGroupId) entries = entries.filter((e) => e.groupId === selectedGroupId);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      entries = entries.filter(
        (e) => e.name.toLowerCase().includes(q) || e.username.toLowerCase().includes(q) ||
               e.description?.toLowerCase().includes(q) || e.url?.toLowerCase().includes(q)
      );
    }
    return entries;
  },
}));
