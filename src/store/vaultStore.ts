import { create } from "zustand";
import { VaultData, PasswordEntry, PasswordGroup, ViewMode, ActiveView, VaultPermission, DeletionRequest, SharedSource, SharedScopeType, SharedUser } from "../types/vault";
import { encryptData, decryptVaultEnvelope, encryptVaultEnvelope, createVaultDataKey, createVaultKeySlot, VaultKeySlot } from "../services/crypto";
import {
  pickSavePath,
  pickOpenPath,
  writeVaultFile,
  readVaultFile,
  getMobileVaultPath,
} from "../services/localFile";
import { persistSave, persistLoad } from "../services/storage";
import {
  createFirebaseVault,
  getFirebaseVault,
  getFirebaseAccount,
  getPersonalFirebaseVault,
  getLegacyPersonalFirebaseVault,
  listFirebaseSharesForEmail,
  createFirebaseAccount,
  signInFirebaseAccount,
  signOutFirebase,
  requestFirebasePasswordReset,
  savePersonalFirebaseVault,
  watchPersonalFirebaseVault,
  updateFirebaseVault,
  updateFirebaseShareAccess,
  deleteFirebaseVault,
  type FirebaseVaultDocument,
  type FirebaseAccount,
} from "../services/firebase";

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

  userInfo: { email: string; name: string; picture: string } | null;
  firebaseAuthenticated: boolean;
  firebaseAccount: FirebaseAccount | null;
  firebaseBackupRevision: number | null;

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
  authenticateFirebase: () => Promise<{ uid: string; email: string | null }>;
  signInAccount: (email: string, password: string) => Promise<void>;
  createAccount: (email: string, password: string) => Promise<void>;
  signOutAccount: () => Promise<void>;
  resetAccountPassword: (email: string) => Promise<void>;
  restoreFirebaseBackup: (masterPassword: string) => Promise<void>;
  applyFirebaseBackupSnapshot: (snapshot: { ciphertext: string; revision: number } | null) => Promise<void>;
  restoreOwnedFirebaseShares: () => Promise<void>;
  syncToFirebase: () => Promise<void>;

  // ── Role ───────────────────────────────────────────────────────────────────
  currentUserRole: (scopeType?: SharedScopeType, scopeId?: string) => VaultPermission;
  canViewGroup: (groupId: string) => boolean;
  canEditGroup: (groupId: string) => boolean;
  canViewEntry: (entry: PasswordEntry) => boolean;
  canEditEntry: (entry: PasswordEntry) => boolean;

  // ── Storage init ───────────────────────────────────────────────────────────
  initFromStorage: () => Promise<void>;

  // ── Vault lifecycle ────────────────────────────────────────────────────────
  createVault: (masterPassword: string, name?: string) => void;
  setVaultName: (name: string) => void;
  unlockVault: (encryptedData: string, masterPassword: string) => Promise<void>;
  lockVault: () => void;
  closeVault: () => void;
  getEncryptedVault: () => Promise<string>;
  addVaultPasswordSlot: (id: string, password: string) => Promise<void>;
  mergeSharedEntries: (entries: PasswordEntry[], group?: PasswordGroup | null) => void;
  mergeFromVault: (otherVault: VaultData) => number;
  addSharedSource: (fileId: string, sharedVault: VaultData, password: string, revision: string | null, openedEnvelope?: { dataKey: string | null; keySlots: import("../services/crypto").VaultKeySlot[] }, backend?: "firebase") => void;
  refreshFirebaseSharedSource: (sourceId: string, document?: FirebaseVaultDocument | null) => Promise<void>;
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
  /** Cria um documento cifrado de colaboração no Firestore. Retorna seu código. */
  createSharedDocument: (params: {
    targetType: SharedScopeType;
    targetId: string | null;
    targetTitle: string;
    collaboratorEmail: string;
    collaboratorRole: VaultPermission;
    sharePassword: string;
  }) => Promise<string>;
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
  userInfo: null,
  firebaseAuthenticated: false,
  firebaseAccount: null,
  firebaseBackupRevision: null,
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

  initFromStorage: async () => {
    const localVaultPath = await persistLoad<string>("pk_local_vault_path");
    for (const key of ["pk_google_token", "pk_user_info", "pk_drive_file_id", "pk_drive_revision", "pk_drive_changes_token", "pk_firebase_vault_id", "pk_firebase_revision", "pk_firebase_vault_map"]) {
      savePersisted(key, null);
    }
    if (localVaultPath) set({ localVaultPath });
  },

  authenticateFirebase: async () => {
    const identity = get().firebaseAccount ?? await getFirebaseAccount();
    if (!identity) throw new Error("Entre na sua conta Password Keeper para acessar a nuvem.");
    set({ firebaseAccount: identity, firebaseAuthenticated: true, userInfo: { email: identity.email, name: identity.email, picture: "" } });
    return { uid: identity.uid, email: identity.email };
  },

  signInAccount: async (email, password) => {
    const account = await signInFirebaseAccount(email, password);
    set({ firebaseAccount: account, firebaseAuthenticated: true, userInfo: { email: account.email, name: account.email, picture: "" }, firebaseBackupRevision: null });
  },

  createAccount: async (email, password) => {
    await createFirebaseAccount(email, password);
  },

  signOutAccount: async () => {
    await signOutFirebase();
    set({ firebaseAccount: null, firebaseAuthenticated: false, firebaseBackupRevision: null, userInfo: null });
  },

  resetAccountPassword: async (email) => requestFirebasePasswordReset(email),

  restoreFirebaseBackup: async (password) => {
    const account = await get().authenticateFirebase();
    let remote = await getPersonalFirebaseVault(account.uid);
    let isLegacyBackup = false;
    if (!remote) {
      remote = await getLegacyPersonalFirebaseVault(account.email ?? "");
      isLegacyBackup = !!remote;
    }
    if (!remote) throw new Error("Esta conta ainda não tem backup na nuvem.");
    await get().unlockVault(remote.ciphertext, password);
    savePersisted("pk_local_vault_path", null);
    set({ localVaultPath: null, firebaseBackupRevision: isLegacyBackup ? null : remote.revision, lastSyncAt: now(), isDirty: false });
    if (isLegacyBackup) await get().syncToFirebase();
  },

  applyFirebaseBackupSnapshot: async (snapshot) => {
    if (!snapshot || snapshot.revision <= (get().firebaseBackupRevision ?? 0)) return;
    const { isDirty, masterPassword } = get();
    if (!masterPassword) return;
    if (isDirty) {
      set({ syncError: "O backup na nuvem mudou em outro dispositivo. Sincronize antes de salvar para evitar sobrescrever alterações." });
      return;
    }
    const opened = await decryptVaultEnvelope(snapshot.ciphertext, masterPassword);
    const raw = JSON.parse(opened.plaintext) as Partial<VaultData>;
    set({
      vault: { ...raw, name: raw.name ?? "Meu cofre", version: raw.version ?? "1", owner: raw.owner ?? "", sharedWith: raw.sharedWith ?? [], deletionRequests: raw.deletionRequests ?? [], groups: raw.groups ?? [], entries: raw.entries ?? [] },
      vaultDataKey: opened.dataKey,
      vaultKeySlots: opened.keySlots,
      firebaseBackupRevision: snapshot.revision,
      isDirty: false,
      lastSyncAt: now(),
      syncError: null,
    });
  },

  restoreOwnedFirebaseShares: async () => {
    const { masterPassword } = get();
    if (!masterPassword) return;
    const identity = await get().authenticateFirebase();
    const email = identity.email?.trim().toLowerCase();
    if (!email) return;
    const documents = await listFirebaseSharesForEmail(email);
    for (const document of documents) {
      if (document.ownerEmail?.toLowerCase() !== email) continue;
      try {
        const opened = await decryptVaultEnvelope(document.ciphertext, masterPassword);
        const sharedVault = JSON.parse(opened.plaintext) as VaultData;
        get().addSharedSource(document.id, sharedVault, masterPassword, String(document.revision), {
          dataKey: opened.dataKey,
          keySlots: opened.keySlots,
        }, "firebase");
      } catch {
        // Ignore documents owned by this account that use a different owner password.
      }
    }
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

  createVault: (masterPassword, name = "Meu cofre") => {
    const vault: VaultData = {
      name: name.trim() || "Meu cofre",
      version: "1.0",
      owner: "",
      sharedWith: [],
      deletionRequests: [],
      groups: [],
      entries: [],
    };
    set({ vault, masterPassword, vaultDataKey: null, vaultKeySlots: [], isLocked: false, isDirty: true });
  },

  setVaultName: (name) => {
    const normalized = name.trim();
    if (!normalized) return;
    set((s) => ({ vault: s.vault ? { ...s.vault, name: normalized } : s.vault, isDirty: true }));
  },

  unlockVault: async (encryptedData, masterPassword) => {
    const opened = await decryptVaultEnvelope(encryptedData, masterPassword);
    const raw = JSON.parse(opened.plaintext);
    // Migrate older vaults that lack new fields
    const vault: VaultData = {
      ...raw,
      name: raw.name ?? "Meu cofre",
      version: raw.version ?? "1",
      groups: raw.groups ?? [],
      entries: raw.entries ?? [],
      sharedWith: raw.sharedWith ?? [],
      deletionRequests: raw.deletionRequests ?? [],
      owner: raw.owner ?? "",
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
    set({
      isLocked: true,
      masterPassword: "",
      vaultDataKey: null,
      vaultKeySlots: [],
      vault: null,
      sharedSources: [],
      firebaseAuthenticated: false,
      selectedEntryId: null,
    });
  },

  closeVault: () => {
    // Clear vault-specific state while requiring a fresh account sign-in next time.
    savePersisted("pk_local_vault_path", null);
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
      firebaseBackupRevision: null,
      firebaseAuthenticated: false,
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

  addSharedSource: (fileId, sharedVault, password, revision, openedEnvelope, backend = "firebase") => {
    const sourceId = sharedVault.collaboration?.documentId || fileId;
    const owner = sharedVault.owner || "Compartilhado";
    const { userInfo } = get();
    const role = sharedVault.owner?.toLowerCase() === userInfo?.email?.toLowerCase()
      ? "owner"
      : sharedVault.sharedWith?.find((u) => u.email.toLowerCase() === userInfo?.email?.toLowerCase())?.role
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
    const syncedAt = now();
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
          const merged = Date.parse(data.updatedAt) > Date.parse(entry.updatedAt)
            ? { ...entry, ...data }
            : entry;
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
          return Date.parse(data.updatedAt) > Date.parse(group.updatedAt)
            ? { ...group, ...data }
            : group;
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
            backend,
            name: sharedVault.collaboration?.title || "Compartilhamento",
            owner,
            role,
            collaboration: sharedVault.collaboration,
            sharedWith: sharedVault.sharedWith ?? [],
            password,
            dataKey: openedEnvelope?.dataKey ?? null,
            keySlots: openedEnvelope?.keySlots ?? [],
            revision,
            lastSyncAt: syncedAt,
            updatedBy: owner,
            updatedAt: syncedAt,
            groups,
            entries,
          },
        ],
      };
    });
  },

  refreshFirebaseSharedSource: async (sourceId, suppliedDocument) => {
    const source = get().sharedSources.find((item) => item.id === sourceId && item.backend === "firebase");
    if (!source) return;
    const document = suppliedDocument === undefined ? await getFirebaseVault(source.fileId) : suppliedDocument;
    if (!document) {
      get().removeSharedSource(sourceId).catch(() => {});
      return;
    }
    const revision = Number.parseInt(source.revision ?? "0", 10) || 0;
    if (document.revision <= revision) return;
    if (source.updatedAt && source.lastSyncAt && Date.parse(source.updatedAt) > Date.parse(source.lastSyncAt)) {
      set({ syncError: `O compartilhamento "${source.name}" mudou em outro dispositivo enquanto havia alterações locais. Revise antes de sincronizar.` });
      return;
    }
    const opened = await decryptVaultEnvelope(document.ciphertext, source.password);
    const sharedVault = JSON.parse(opened.plaintext) as VaultData;
    get().addSharedSource(source.fileId, sharedVault, source.password, String(document.revision), {
      dataKey: opened.dataKey,
      keySlots: opened.keySlots,
    }, "firebase");
  },

  refreshSharedSources: async () => {
    const firebaseSources = get().sharedSources.filter((source) => source.backend === "firebase");
    for (const source of firebaseSources) await get().refreshFirebaseSharedSource(source.id);
    return false;
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

    let revision: string;
    if (source.backend === "firebase") {
      const nextRevision = await updateFirebaseVault(
        source.fileId,
        encrypted,
        Number.parseInt(source.revision ?? "0", 10) || undefined,
      );
      revision = String(nextRevision);
    } else {
      throw new Error("Este compartilhamento antigo não está conectado. Importe o arquivo novamente.");
    }
    const syncedAt = now();
    set((s) => ({
      sharedSources: s.sharedSources.map((item) => item.id === sourceId
        ? { ...item, revision, lastSyncAt: syncedAt, updatedBy: get().userInfo?.email, updatedAt: syncedAt }
        : item),
    }));
  },

  removeSharedSource: async (sourceId, cancelForEveryone = false) => {
    const source = get().sharedSources.find((item) => item.id === sourceId);
    if (!source) return;
    if (cancelForEveryone) {
      if (source.role !== "owner") throw new Error("Apenas o proprietário pode cancelar para todos.");
      if (source.backend !== "firebase") throw new Error("Compartilhamentos do Drive não são mais acessados pelo aplicativo.");
      await deleteFirebaseVault(source.fileId);
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
          ? await getMobileVaultPath(get().vault?.name)
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
          ? (get().localVaultPath ?? await getMobileVaultPath(get().vault?.name))
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

  clearSyncError: () => set({ syncError: null }),

  forceSync: async () => {
    const { firebaseAccount, localVaultPath, isDirty, vault } = get();
    const isAndroid = /android/i.test(navigator.userAgent);
    // Avoid replacing the owner's personal backup with a collaborator envelope.
    const isOwnerOfCollabVault = !!vault?.collaboration && get().currentUserRole() === "owner";
    set({ syncError: null });
    try {
      if (isDirty && !isOwnerOfCollabVault) {
        if (localVaultPath || isAndroid) await get().saveToLocalFile(localVaultPath ?? undefined);
        if (firebaseAccount) await get().syncToFirebase();
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
      set({ syncError: String(err) });
    }
  },

  syncToFirebase: async () => {
    const { vault, masterPassword, firebaseAccount } = get();
    if (!firebaseAccount || !vault || !masterPassword) return;
    if (vault.collaboration) throw new Error("Cofres colaborativos devem ser sincronizados pelo documento compartilhado.");
    set({ isSyncing: true, syncError: null });
    try {
      const encrypted = await get().getEncryptedVault();
      const revision = await savePersonalFirebaseVault(
        firebaseAccount.uid,
        firebaseAccount.email,
        encrypted,
        get().firebaseBackupRevision ?? undefined,
      );
      set({ firebaseBackupRevision: revision, isDirty: false, lastSyncAt: now(), isSyncing: false });
    } catch (err) {
      set({ syncError: String(err), isSyncing: false });
      throw err;
    }
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
    const { vault, firebaseAccount, userInfo } = get();
    if (!vault) throw new Error("Cofre não está desbloqueado");
    if (!sharePassword) throw new Error("Senha de compartilhamento é obrigatória");

    const identity = await get().authenticateFirebase();
    const collaborator = collaboratorEmail.trim().toLowerCase();
    const documentId = generateId();
    const ownerEmail = identity.email?.trim().toLowerCase();
    if (!ownerEmail || (firebaseAccount?.email && ownerEmail !== firebaseAccount.email.trim().toLowerCase())) throw new Error("Não foi possível confirmar o e-mail da conta.");

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

    await createFirebaseVault(documentId, encrypted, {
      ownerUid: identity.uid,
      memberUids: [identity.uid],
      editorUids: [],
      ownerEmail,
      memberEmails: [collaborator],
      editorEmails: collaboratorRole === "reader" ? [] : [collaborator],
      kind: "collaboration",
      collaboration,
    });
    const created = await getFirebaseVault(documentId);
    if (!created || created.ciphertext !== encrypted || !created.memberEmails?.includes(collaborator)) {
      throw new Error("O compartilhamento na nuvem não passou na verificação.");
    }
    get().addSharedSource(documentId, sharedVault, ownerPassword, String(created.revision), { dataKey, keySlots }, "firebase");
    get().updateSharedUserRole(collaborator, collaboratorRole, targetType, targetId ?? undefined, targetTitle);
    return documentId;
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
    const sources = get().sharedSources.filter((source) => source.backend === "firebase" && source.role === "owner"
      && source.sharedWith.some((user) => user.email.toLowerCase() === normalizedEmail
        && (user.scopeType ?? "vault") === scopeType && (user.scopeId ?? "") === (scopeId ?? "")));
    for (const source of sources) {
      const sharedWith = source.sharedWith.map((user) => user.email.toLowerCase() === normalizedEmail
        && (user.scopeType ?? "vault") === scopeType && (user.scopeId ?? "") === (scopeId ?? "")
        ? { ...user, role }
        : user);
      set((s) => ({ sharedSources: s.sharedSources.map((item) => item.id === source.id ? { ...item, sharedWith } : item) }));
      const members = [source.owner, ...sharedWith.map((user) => user.email)];
      const editors = sharedWith.filter((user) => user.role !== "reader").map((user) => user.email);
      updateFirebaseShareAccess(source.fileId, members, editors).then((revision) => {
        set((s) => ({ sharedSources: s.sharedSources.map((item) => item.id === source.id ? { ...item, revision: String(revision) } : item) }));
        return get().syncSharedSource(source.id);
      }).catch((error) => set({ syncError: String(error) }));
    }
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
    const sources = get().sharedSources.filter((source) => source.backend === "firebase" && source.role === "owner"
      && source.sharedWith.some((user) => user.email.toLowerCase() === normalizedEmail
        && (!scopeType || ((user.scopeType ?? "vault") === scopeType && (user.scopeId ?? "") === (scopeId ?? "")))));
    for (const source of sources) {
      const sharedWith = source.sharedWith.filter((user) => user.email.toLowerCase() !== normalizedEmail
        || (scopeType && ((user.scopeType ?? "vault") !== scopeType || (user.scopeId ?? "") !== (scopeId ?? ""))));
      set((s) => ({ sharedSources: s.sharedSources.map((item) => item.id === source.id ? { ...item, sharedWith } : item) }));
      const members = [source.owner, ...sharedWith.map((user) => user.email)];
      const editors = sharedWith.filter((user) => user.role !== "reader").map((user) => user.email);
      updateFirebaseShareAccess(source.fileId, members, editors).then((revision) => {
        set((s) => ({ sharedSources: s.sharedSources.map((item) => item.id === source.id ? { ...item, revision: String(revision) } : item) }));
        return get().syncSharedSource(source.id);
      }).catch((error) => set({ syncError: String(error) }));
    }
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
