export type VaultPermission = "owner" | "editor" | "reader";

export interface SharedUser {
  email: string;
  role: VaultPermission;
  scopeType?: SharedScopeType;
  scopeId?: string;
  scopeTitle?: string;
  addedAt: string;
}

export type SharedScopeType = "vault" | "group" | "entry";

export interface VaultCollaboration {
  documentId: string;
  type: SharedScopeType;
  title: string;
  createdFromId?: string;
  createdAt: string;
}

export interface DeletionRequest {
  id: string;
  entryId: string;
  entryName: string;
  requestedBy: string;
  requestedAt: string;
}

export interface PasswordEntry {
  id: string;
  sourceEntryId?: string;
  sharedSourceId?: string;
  name: string;
  description: string;
  icon: string;
  username: string;
  password: string;
  url?: string;
  notes?: string;
  groupId?: string;
  favorite?: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PasswordGroup {
  id: string;
  sourceGroupId?: string;
  sharedSourceId?: string;
  name: string;
  description: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
}

export interface VaultData {
  /** User-facing vault name, also used for the Google Drive .keep filename. */
  name?: string;
  version: string;
  owner: string;
  collaboration?: VaultCollaboration;
  sharedWith: SharedUser[];
  deletionRequests: DeletionRequest[];
  groups: PasswordGroup[];
  entries: PasswordEntry[];
}

export interface SharedSource {
  id: string;
  fileId: string;
  name: string;
  owner: string;
  role: VaultPermission;
  collaboration?: VaultCollaboration;
  sharedWith: SharedUser[];
  password: string;
  /** dataKey base64 para re-encriptar o arquivo compartilhado (envelope v2) */
  dataKey?: string | null;
  /** keySlots do envelope do arquivo compartilhado */
  keySlots?: import("../services/crypto").VaultKeySlot[];
  revision: string | null;
  lastSyncAt: string | null;
  updatedBy?: string;
  updatedAt?: string;
  groups: PasswordGroup[];
  entries: PasswordEntry[];
}

export interface GoogleToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  token_type: string;
  client_id?: string;
}

export type ViewMode = "grid" | "list";
export type ActiveView = "all" | "favorites" | "group";
