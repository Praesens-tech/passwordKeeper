import { useState } from "react";
import { ShieldCheck, Search, Star, LayoutGrid, Plus, Lock, Cloud, Edit, Trash2, Share2, HardDrive, Flag, Info, FolderOpen, LogOut, Power, X, RefreshCw, AlertCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useVaultStore } from "../store/vaultStore";
import { usePlatform } from "../hooks/usePlatform";
import { GroupForm } from "./GroupForm";
import { GoogleDriveModal } from "./GoogleDriveModal";
import { ShareModal } from "./ShareModal";
import { DeletionRequests } from "./DeletionRequests";
import { AboutScreen } from "./AboutScreen";
import { ImportSharedFile } from "./ImportSharedFile";
import { SharedUsersModal } from "./SharedUsersModal";
import { PasswordGroup } from "../types/vault";
import { IconDisplay } from "./IconDisplay";

interface SidebarProps {
  onAddEntry: (groupId?: string) => void;
  onForceSync?: () => void;
  isForceSyncing?: boolean;
}

export function Sidebar({ onAddEntry, onForceSync, isForceSyncing }: SidebarProps) {
  const {
    vault, activeView, selectedGroupId, searchQuery, googleToken, userInfo,
    isSyncing, isDirty, localVaultPath, sidebarOpen, sharedSources,
    syncError, clearSyncError,
    setActiveView, selectGroup, setSearchQuery, lockVault,
    saveToLocalFile, updateEntry, removeSharedSource, canViewGroup, canViewEntry, canEditGroup,
  } = useVaultStore();
  const receivedSharedSources = sharedSources.filter((source) => source.role !== "owner");


  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<PasswordGroup | null>(null);
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [shareGroup, setShareGroup] = useState<PasswordGroup | null>(null);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<string | null>(null);
  const [showDeletionRequests, setShowDeletionRequests] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showSharedUsers, setShowSharedUsers] = useState(false);
  const [confirmRemoveShare, setConfirmRemoveShare] = useState<{ id: string; all: boolean } | null>(null);
  const { deleteGroup, currentUserRole, closeVault } = useVaultStore();

  const { isAndroid } = usePlatform();
  const role = currentUserRole();
  const isOwner = role === "owner";
  const pendingDeletionCount = vault?.deletionRequests?.length ?? 0;

  function handleDropOnGroup(e: React.DragEvent, groupId: string | null) {
    e.preventDefault();
    const entryId = e.dataTransfer.getData("entryId");
    if (entryId) updateEntry(entryId, { groupId: groupId ?? undefined });
  }

  const visibleVaultEntries = vault?.entries.filter((entry) => canViewEntry(entry)) ?? [];
  const visibleVaultGroups = vault?.groups.filter((group) => canViewGroup(group.id)) ?? [];
  const totalEntries = visibleVaultEntries.length + receivedSharedSources.flatMap((source) => source.entries).length;
  const favoriteCount = visibleVaultEntries.filter((e) => e.favorite).length
    + receivedSharedSources.flatMap((source) => source.entries).filter((entry) => entry.favorite).length;

  function getGroupEntryCount(groupId: string) {
    return visibleVaultEntries.filter((e) => e.groupId === groupId).length;
  }

  return (
    <>
      {/* Overlay para fechar o drawer no mobile */}
      {isAndroid && sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50"
          onClick={() => useVaultStore.getState().toggleSidebar()}
        />
      )}
      <aside
        className={`
          flex flex-col bg-vault-sidebar border-r border-vault-border overflow-hidden
          transition-transform duration-250
          ${isAndroid
            ? `fixed left-0 z-40 w-72 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`
            : `flex-shrink-0 transition-[width] duration-200 h-full ${sidebarOpen ? "w-64" : "w-0 border-r-0"}`
          }
        `}
        style={isAndroid ? {
          top: "env(safe-area-inset-top)",
          height: "calc(100% - env(safe-area-inset-top))",
        } : undefined}
      >
        {/* Logo */}
        <div className="p-5 border-b border-vault-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-vault-primary to-vault-secondary flex items-center justify-center">
              <ShieldCheck size={18} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-vault-text font-bold text-sm leading-tight">Password Keeper</h1>
              <p className="text-vault-textMuted text-xs">Cofre seguro</p>
            </div>
            {/* Role badge */}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
              role === "owner"
                ? "bg-vault-primary/20 text-vault-primary"
                : role === "editor"
                ? "bg-vault-success/20 text-vault-success"
                : "bg-vault-card text-vault-textMuted"
            }`}>
              {role === "owner" ? "Proprietário" : role === "editor" ? "Editor" : "Leitura"}
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-vault-textMuted" />
            <input
              type="text"
              placeholder="Buscar senhas..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-vault-card border border-vault-border rounded-xl pl-9 pr-3 py-2 text-sm text-vault-text placeholder-vault-textMuted focus:outline-none focus:border-vault-primary transition-colors"
            />
          </div>
        </div>

        {/* Add entry button — hidden for readers */}
        {role !== "reader" && (
          <div className="px-4 pb-2">
            <button
              onClick={() => onAddEntry()}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-vault-primary hover:bg-vault-primaryHover rounded-xl text-white text-sm font-medium transition-all hover:shadow-lg hover:shadow-vault-primary/20"
            >
              <Plus size={16} /> Nova Senha
            </button>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-3 overflow-y-auto py-2 space-y-0.5">
          {/* All — also a drop target to remove entry from group */}
          <NavItem
            icon={<LayoutGrid size={16} />}
            label="Todas as Senhas"
            count={totalEntries}
            active={activeView === "all"}
            onClick={() => setActiveView("all")}
            onDrop={(e) => handleDropOnGroup(e, null)}
          />

          {/* Favorites */}
          <NavItem
            icon={<Star size={16} />}
            label="Favoritas"
            count={favoriteCount}
            active={activeView === "favorites"}
            onClick={() => setActiveView("favorites")}
          />

          {/* Groups section */}
          <div className="pt-3 pb-1">
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-xs font-semibold text-vault-textMuted uppercase tracking-wider">
                Grupos
              </span>
              <button
                onClick={() => setShowGroupForm(true)}
                disabled={role === "reader"}
                className="p-1 rounded-lg text-vault-textMuted hover:text-vault-primary hover:bg-vault-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Novo grupo"
              >
                <Plus size={14} />
              </button>
            </div>

            {visibleVaultGroups.length === 0 && (
              <p className="text-xs text-vault-textMuted px-2 py-2">
                Nenhum grupo criado
              </p>
            )}

            {visibleVaultGroups.map((group) => (
              <GroupNavItem
                key={group.id}
                group={group}
                count={getGroupEntryCount(group.id)}
                active={activeView === "group" && selectedGroupId === group.id}
                onClick={() => selectGroup(group.id)}
                onEdit={canEditGroup(group.id) ? () => { setEditingGroup(group); setShowGroupForm(true); } : undefined}
                onShare={isOwner ? () => setShareGroup(group) : undefined}
                onDelete={isOwner ? () => setConfirmDeleteGroup(group.id) : undefined}
                onAddEntry={canEditGroup(group.id) ? () => onAddEntry(group.id) : undefined}
                onDrop={(e) => handleDropOnGroup(e, group.id)}
              />
            ))}
          </div>

          {receivedSharedSources.length > 0 && (
            <div className="pt-3 pb-1">
              <div className="px-2 mb-1">
                <span className="text-xs font-semibold text-vault-textMuted uppercase tracking-wider">
                  Compartilhados
                </span>
              </div>
              {receivedSharedSources.map((source) => (
                <div key={source.id} className="mb-2">
                  <div className="flex items-center gap-1 px-2 py-1">
                    <span className="flex-1 min-w-0 text-xs text-vault-textMuted truncate">
                      {source.owner}
                    </span>
                    <button
                      onClick={() => setConfirmRemoveShare({ id: source.id, all: false })}
                      className="p-1 rounded text-vault-textMuted hover:text-vault-danger hover:bg-vault-danger/10"
                      title="Remover compartilhamento da minha lista"
                    >
                      <X size={12} />
                    </button>
                    {source.role === "owner" && (
                      <button
                        onClick={() => setConfirmRemoveShare({ id: source.id, all: true })}
                        className="p-1 rounded text-vault-textMuted hover:text-vault-danger hover:bg-vault-danger/10"
                        title="Cancelar compartilhamento para todos"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                  {source.groups.length === 0 && source.entries.length > 0 && (
                    <NavItem
                      icon={<Share2 size={16} />}
                      label={source.name}
                      count={source.entries.length}
                      active={false}
                      onClick={() => useVaultStore.setState({ activeView: "group", selectedGroupId: `shared:${source.id}:ungrouped`, selectedEntryId: null })}
                    />
                  )}
                  {source.groups.map((group) => (
                    <GroupNavItem
                      key={group.id}
                      group={group}
                      count={source.entries.filter((entry) => entry.groupId === group.id).length}
                      active={activeView === "group" && selectedGroupId === group.id}
                      onClick={() => selectGroup(group.id)}
                      onAddEntry={source.role !== "reader" ? () => onAddEntry(group.id) : undefined}
                      onDrop={(e) => handleDropOnGroup(e, group.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </nav>

        {/* Bottom actions */}
        <div
          className="border-t border-vault-border p-3 space-y-1"
          style={isAndroid ? { paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" } : undefined}
        >

          {/* Save locally — desktop only */}
          {!isAndroid && (
            <button
              onClick={() => saveToLocalFile()}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors hover:bg-vault-card"
            >
              <HardDrive size={16} className={localVaultPath ? "text-amber-400" : "text-vault-textMuted"} />
              <span className={`flex-1 text-left truncate text-xs ${localVaultPath ? "text-vault-textSecondary" : "text-vault-textMuted"}`}>
                {localVaultPath
                  ? localVaultPath.split(/[\\/]/).pop()
                  : "Salvar localmente..."}
              </span>
              {isDirty && localVaultPath && (
                <span className="w-2 h-2 rounded-full bg-vault-warning flex-shrink-0" title="Alterações não salvas" />
              )}
            </button>
          )}

          {/* Google Drive */}
          {googleToken ? (
            <div className="flex items-center gap-1 px-3 py-2 rounded-xl hover:bg-vault-card transition-colors">
              <Cloud size={16} className="text-vault-primary flex-shrink-0" />
              <button
                onClick={() => setShowDriveModal(true)}
                className="flex-1 text-left truncate text-xs text-vault-textSecondary min-w-0"
              >
                {userInfo?.email ?? "Drive conectado"}
              </button>
              {(isSyncing || isForceSyncing) && (
                <span className="w-3 h-3 rounded-full border border-vault-primary border-t-transparent animate-spin flex-shrink-0" />
              )}
              <button
                onClick={() => { useVaultStore.getState().setGoogleToken(null); useVaultStore.getState().setUserInfo(null); useVaultStore.getState().setDriveFileId(null); }}
                className="p-1 rounded text-vault-textMuted hover:text-vault-danger transition-colors flex-shrink-0"
                title="Desconectar conta Google"
              >
                <LogOut size={13} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowDriveModal(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors hover:bg-vault-card"
            >
              <Cloud size={16} className="text-vault-textMuted" />
              <span className="flex-1 text-left truncate text-xs text-vault-textMuted">Google Drive</span>
            </button>
          )}

          {/* Force sync button — visible when connected and there are shared sources or dirty state */}
          {googleToken && (isDirty || sharedSources.length > 0) && (
            <button
              onClick={onForceSync}
              disabled={isSyncing || isForceSyncing}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors hover:bg-vault-card disabled:opacity-50 disabled:cursor-not-allowed"
              title="Forçar sincronização agora"
            >
              <RefreshCw size={16} className={`${isForceSyncing ? "animate-spin text-vault-primary" : "text-vault-textMuted"}`} />
              <span className={`flex-1 text-left text-xs ${isForceSyncing ? "text-vault-primary" : "text-vault-textMuted"}`}>
                {isForceSyncing ? "Sincronizando..." : "Sincronizar agora"}
              </span>
            </button>
          )}

          {/* Sync error alert */}
          {syncError && (
            <div className="mx-1 flex items-start gap-2 px-3 py-2 rounded-xl bg-vault-danger/10 border border-vault-danger/20">
              <AlertCircle size={14} className="text-vault-danger flex-shrink-0 mt-0.5" />
              <p className="flex-1 text-xs text-vault-danger leading-snug line-clamp-3">{syncError}</p>
              <button onClick={clearSyncError} className="text-vault-danger hover:opacity-70 flex-shrink-0">
                <X size={13} />
              </button>
            </div>
          )}

          {/* Deletion requests — only visible to owner when there are pending ones */}
          {isOwner && pendingDeletionCount > 0 && (
            <button
              onClick={() => setShowDeletionRequests(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm bg-vault-warning/10 border border-vault-warning/30 text-vault-warning hover:bg-vault-warning/20 transition-colors"
            >
              <Flag size={16} />
              <span className="flex-1 text-left text-xs">Solicitações de exclusão</span>
              <span className="w-5 h-5 rounded-full bg-vault-warning text-white text-xs flex items-center justify-center font-bold">
                {pendingDeletionCount}
              </span>
            </button>
          )}

          {/* Manage shared users — owner only */}
          {isOwner && (
            <button
              onClick={() => setShowSharedUsers(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-vault-textMuted hover:text-vault-text hover:bg-vault-card transition-colors"
            >
              <Share2 size={16} />
              <span className="flex-1 text-left">Compartilhar com...</span>
              {(vault?.sharedWith?.length ?? 0) > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-vault-card text-vault-textMuted">
                  {vault!.sharedWith.length}
                </span>
              )}
            </button>
          )}

          {/* Open shared collaboration */}
          <button
            onClick={() => setShowImport(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-vault-textMuted hover:text-vault-text hover:bg-vault-card transition-colors"
          >
            <Share2 size={16} />
            Abrir compartilhamento
          </button>

          {/* About */}
          <button
            onClick={() => setShowAbout(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-vault-textMuted hover:text-vault-text hover:bg-vault-card transition-colors"
          >
            <Info size={16} />
            Sobre o aplicativo
          </button>

          {/* Close vault — desktop only */}
          {!isAndroid && (
            <button
              onClick={closeVault}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-vault-textMuted hover:text-vault-text hover:bg-vault-card transition-colors"
            >
              <FolderOpen size={16} />
              Fechar e abrir outro cofre
            </button>
          )}

          {/* Lock */}
          <button
            onClick={lockVault}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-vault-textMuted hover:text-vault-danger hover:bg-vault-danger/10 transition-colors"
          >
            <Lock size={16} />
            Bloquear cofre
          </button>

          {/* Exit — Android only */}
          {isAndroid && (
            <button
              onClick={() => invoke("exit_app")}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-vault-textMuted hover:text-vault-danger hover:bg-vault-danger/10 transition-colors"
            >
              <Power size={16} />
              Sair
            </button>
          )}
        </div>
      </aside>

      {/* Modals */}
      {showGroupForm && (
        <GroupForm
          group={editingGroup ?? undefined}
          onClose={() => { setShowGroupForm(false); setEditingGroup(null); }}
        />
      )}
      {showDriveModal && <GoogleDriveModal onClose={() => setShowDriveModal(false)} />}
      {shareGroup && (
        <ShareModal target={shareGroup} type="group" onClose={() => setShareGroup(null)} />
      )}
      {showDeletionRequests && <DeletionRequests onClose={() => setShowDeletionRequests(false)} />}
      {showAbout && <AboutScreen onClose={() => setShowAbout(false)} />}
      {showImport && <ImportSharedFile onClose={() => setShowImport(false)} />}
      {showSharedUsers && <SharedUsersModal onClose={() => setShowSharedUsers(false)} />}

      {/* Delete group confirm */}
      {confirmDeleteGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-vault-card border border-vault-border rounded-2xl p-6 w-80 shadow-2xl">
            <h3 className="text-vault-text font-semibold mb-2">Excluir grupo?</h3>
            <p className="text-vault-textMuted text-sm mb-4">
              As senhas do grupo não serão excluídas, apenas desvinculadas.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteGroup(null)}
                className="flex-1 py-2 bg-vault-sidebar border border-vault-border rounded-xl text-vault-textMuted text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={() => { deleteGroup(confirmDeleteGroup); setConfirmDeleteGroup(null); }}
                className="flex-1 py-2 bg-vault-danger/20 border border-vault-danger/40 rounded-xl text-vault-danger text-sm font-medium"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmRemoveShare && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-vault-card border border-vault-border rounded-2xl p-6 w-80 shadow-2xl">
            <h3 className="text-vault-text font-semibold mb-2">
              {confirmRemoveShare.all ? "Cancelar compartilhamento?" : "Remover da lista?"}
            </h3>
            <p className="text-vault-textMuted text-sm mb-4">
              {confirmRemoveShare.all
                ? (sharedSources.find((source) => source.id === confirmRemoveShare.id)?.backend === "firebase"
                    ? "O documento compartilhado será removido do Firebase e os outros usuários perderão acesso."
                    : "O arquivo colaborativo será removido do Drive e os outros usuários deixarão de sincronizar.")
                : "O compartilhamento será removido apenas deste dispositivo."}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmRemoveShare(null)}
                className="flex-1 py-2 bg-vault-sidebar border border-vault-border rounded-xl text-vault-textMuted text-sm"
              >
                Voltar
              </button>
              <button
                onClick={() => {
                  const pending = confirmRemoveShare;
                  setConfirmRemoveShare(null);
                  removeSharedSource(pending.id, pending.all).catch(() => {});
                }}
                className="flex-1 py-2 bg-vault-danger/20 border border-vault-danger/40 rounded-xl text-vault-danger text-sm font-medium"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  onDrop?: (e: React.DragEvent) => void;
}

function NavItem({ icon, label, count, active, onClick, onDrop }: NavItemProps) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <button
      onClick={onClick}
      onDragOver={(e) => { if (onDrop) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { setDragOver(false); onDrop?.(e); }}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
        dragOver
          ? "bg-vault-primary/20 border border-vault-primary/40 text-vault-primary"
          : active
          ? "bg-vault-primary/15 text-vault-primary border border-vault-primary/20"
          : "text-vault-textMuted hover:bg-vault-card hover:text-vault-text"
      }`}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {dragOver && <span className="text-xs text-vault-primary">Soltar aqui</span>}
      {!dragOver && count !== undefined && (
        <span className={`text-xs px-1.5 py-0.5 rounded-full ${active ? "bg-vault-primary/20 text-vault-primary" : "bg-vault-card text-vault-textMuted"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

interface GroupNavItemProps {
  group: PasswordGroup;
  count: number;
  active: boolean;
  onClick: () => void;
  onEdit?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
  onAddEntry?: () => void;
  onDrop: (e: React.DragEvent) => void;
}

function GroupNavItem({ group, count, active, onClick, onEdit, onShare, onDelete, onAddEntry, onDrop }: GroupNavItemProps) {
  const [showActions, setShowActions] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <button
        onClick={onClick}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { setDragOver(false); onDrop(e); }}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all border ${
          dragOver
            ? "bg-vault-primary/20 border-vault-primary/50 text-vault-primary"
            : active
            ? "bg-vault-primary/15 text-vault-primary border-vault-primary/20"
            : "border-transparent text-vault-textMuted hover:bg-vault-card hover:text-vault-text"
        }`}
      >
        <span className="w-5 h-5 flex items-center justify-center flex-shrink-0">
          <IconDisplay icon={group.icon} size="w-5 h-5" />
        </span>
        <span className="flex-1 text-left truncate">{group.name}</span>
        {dragOver ? (
          <span className="text-xs text-vault-primary font-medium">Mover aqui</span>
        ) : showActions ? (
          <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
            {onAddEntry && (
              <button onClick={onAddEntry} title="Adicionar senha neste grupo" className="p-1 rounded hover:bg-vault-success/20 hover:text-vault-success transition-colors">
                <Plus size={12} />
              </button>
            )}
            {onEdit && (
              <button onClick={onEdit} className="p-1 rounded hover:bg-vault-primary/20 hover:text-vault-primary transition-colors">
                <Edit size={12} />
              </button>
            )}
            {onShare && (
              <button onClick={onShare} className="p-1 rounded hover:bg-vault-accent/20 hover:text-vault-accent transition-colors">
                <Share2 size={12} />
              </button>
            )}
            {onDelete && (
              <button onClick={onDelete} className="p-1 rounded hover:bg-vault-danger/20 hover:text-vault-danger transition-colors">
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ) : (
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${active ? "bg-vault-primary/20 text-vault-primary" : "bg-vault-card text-vault-textMuted"}`}>
            {count}
          </span>
        )}
      </button>
    </div>
  );
}
