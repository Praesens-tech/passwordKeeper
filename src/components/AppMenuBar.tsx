import { useState, useRef, useEffect } from "react";
import { FolderOpen, Plus, Save, LogOut, Info, HardDrive, Cloud, Share2, RefreshCw, Key, PanelLeft, Power, Menu } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useVaultStore } from "../store/vaultStore";
import { usePlatform } from "../hooks/usePlatform";
import { AboutScreen } from "./AboutScreen";
import { GoogleDriveModal } from "./GoogleDriveModal";
import { SharedUsersModal } from "./SharedUsersModal";
import { BackupModal } from "./BackupModal";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { checkForAppUpdate } from "../services/autoUpdate";

interface AppMenuBarProps {
  onForceSync?: () => void;
  isForceSyncing?: boolean;
}

export function AppMenuBar({ onForceSync, isForceSyncing }: AppMenuBarProps) {
  const { saveToLocalFile, localVaultPath, closeVault, currentUserRole, toggleSidebar, sidebarOpen } = useVaultStore();
  const { isAndroid } = usePlatform();
  const [openMenu, setOpenMenu] = useState<"file" | "utils" | "help" | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showDrive, setShowDrive] = useState(false);
  const [showShared, setShowShared] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggle(menu: "file" | "utils" | "help") {
    setOpenMenu((prev) => (prev === menu ? null : menu));
  }

  function close() { setOpenMenu(null); }

  const isOwner = currentUserRole() === "owner";

  async function handleCheckUpdate() {
    close();
    setIsCheckingUpdate(true);
    try {
      await checkForAppUpdate("manual");
    } finally {
      setIsCheckingUpdate(false);
    }
  }

  return (
    <>
      <div
        ref={barRef}
        className={`flex items-center bg-vault-sidebar border-b border-vault-border px-1 flex-shrink-0 select-none z-50 ${isAndroid ? "h-14" : "h-9"}`}
      >
        {/* Sidebar toggle — hamburguer no Android, PanelLeft no desktop */}
        <button
          onClick={toggleSidebar}
          className={`${isAndroid ? "p-3" : "p-2"} rounded mr-1 transition-colors ${
            sidebarOpen
              ? "text-vault-textSecondary hover:text-vault-text hover:bg-vault-card/50"
              : "text-vault-primary bg-vault-primary/10 hover:bg-vault-primary/20"
          }`}
          title={sidebarOpen ? "Ocultar painel lateral" : "Mostrar painel lateral"}
        >
          {isAndroid ? <Menu size={26} /> : <PanelLeft size={15} />}
        </button>

        {/* Menus — ocultados no Android */}
        {!isAndroid && (
          <>
            <MenuButton label="Arquivo" open={openMenu === "file"} onClick={() => toggle("file")} />
            <MenuButton label="Utilitários" open={openMenu === "utils"} onClick={() => toggle("utils")} />
            <MenuButton label="Ajuda" open={openMenu === "help"} onClick={() => toggle("help")} />
          </>
        )}

        {/* Arquivo dropdown */}
        {openMenu === "file" && (
          <Dropdown anchor="left-[0px] top-9">
            <MenuItem icon={<Plus size={14} />} label="Novo cofre" onClick={() => { close(); closeVault(); }} />
            <MenuItem icon={<FolderOpen size={14} />} label="Abrir arquivo local..." onClick={() => { close(); closeVault(); }} />
            <MenuItem icon={<Cloud size={14} />} label="Abrir do Google Drive..." onClick={() => { close(); closeVault(); }} />
            <Separator />
            <MenuItem
              icon={<Save size={14} />}
              label={localVaultPath ? "Salvar" : "Salvar como..."}
              onClick={() => { close(); saveToLocalFile(localVaultPath ?? undefined); }}
            />
            <MenuItem icon={<HardDrive size={14} />} label="Google Drive..." onClick={() => { close(); setShowDrive(true); }} />
            {isOwner && (
              <>
                <Separator />
                <MenuItem icon={<Share2 size={14} />} label="Compartilhar com..." onClick={() => { close(); setShowShared(true); }} />
              </>
            )}
            <Separator />
            <MenuItem icon={<LogOut size={14} />} label="Fechar cofre" danger onClick={() => { close(); closeVault(); }} />
            <Separator />
            <MenuItem icon={<Power size={14} />} label="Sair" danger onClick={() => { close(); invoke("exit_app"); }} />
          </Dropdown>
        )}

        {/* Utilitários dropdown */}
        {openMenu === "utils" && (
          <Dropdown anchor="left-[72px] top-9">
            <MenuItem
              icon={<RefreshCw size={14} className={isForceSyncing ? "animate-spin" : ""} />}
              label={isForceSyncing ? "Sincronizando..." : "Sincronizar agora"}
              onClick={() => { close(); onForceSync?.(); }}
            />
            <MenuItem icon={<RefreshCw size={14} />} label="Backup & Sincronização..." onClick={() => { close(); setShowBackup(true); }} />
            {isOwner && <MenuItem icon={<Key size={14} />} label="Trocar senha do cofre..." onClick={() => { close(); setShowChangePassword(true); }} />}
          </Dropdown>
        )}

        {/* Ajuda dropdown */}
        {openMenu === "help" && (
          <Dropdown anchor="left-[142px] top-9">
            <MenuItem
              icon={<RefreshCw size={14} className={isCheckingUpdate ? "animate-spin" : ""} />}
              label={isCheckingUpdate ? "Verificando..." : "Atualizar"}
              onClick={handleCheckUpdate}
            />
            <Separator />
            <MenuItem icon={<Info size={14} />} label="Sobre o Password Keeper" onClick={() => { close(); setShowAbout(true); }} />
          </Dropdown>
        )}
      </div>

      {showAbout && <AboutScreen onClose={() => setShowAbout(false)} />}
      {showDrive && <GoogleDriveModal onClose={() => setShowDrive(false)} />}
      {showShared && <SharedUsersModal onClose={() => setShowShared(false)} />}
      {showBackup && <BackupModal onClose={() => setShowBackup(false)} />}
      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function MenuButton({ label, open, onClick }: { label: string; open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 h-full text-xs font-medium transition-colors rounded flex items-center gap-1 ${
        open
          ? "bg-vault-card text-vault-text"
          : "text-vault-textSecondary hover:text-vault-text hover:bg-vault-card/50"
      }`}
    >
      {label}
    </button>
  );
}

function Dropdown({ anchor, children }: { anchor: string; children: React.ReactNode }) {
  return (
    <div className={`absolute ${anchor} min-w-52 bg-vault-card border border-vault-border rounded-xl shadow-2xl shadow-black/50 py-1.5 z-50 animate-fade-in`}>
      {children}
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger = false }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2 text-xs transition-colors ${
        danger
          ? "text-vault-danger hover:bg-vault-danger/10"
          : "text-vault-textSecondary hover:text-vault-text hover:bg-vault-sidebar"
      }`}
    >
      <span className={danger ? "text-vault-danger" : "text-vault-textMuted"}>{icon}</span>
      {label}
    </button>
  );
}

function Separator() {
  return <div className="my-1 border-t border-vault-border" />;
}
