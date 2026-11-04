import { useState } from "react";
import { X, Download, Upload, FolderOpen, Check, AlertCircle, Loader2, Lock, Eye, EyeOff, HardDrive, Cloud, RefreshCw } from "lucide-react";
import { useVaultStore } from "../store/vaultStore";
import { decryptVaultEnvelope } from "../services/crypto";
import { pickSavePath, pickOpenPath, writeVaultFile, readVaultFile } from "../services/localFile";
import { downloadVaultFile } from "../services/googleDrive";
import { VaultData } from "../types/vault";

interface BackupModalProps {
  onClose: () => void;
}

type PanelStatus = "idle" | "loading" | "done" | "error";

export function BackupModal({ onClose }: BackupModalProps) {
  const {
    getEncryptedVault, ensureValidToken,
    driveFileId, googleToken, firebaseVaultId, mergeFromVault, syncToCloud, syncToFirebase,
  } = useVaultStore();

  // Panel 1: export local copy
  const [exportStatus, setExportStatus] = useState<PanelStatus>("idle");
  const [exportError, setExportError] = useState("");

  // Panel 2: download Drive → local
  const [downloadStatus, setDownloadStatus] = useState<PanelStatus>("idle");
  const [downloadError, setDownloadError] = useState("");

  // Panel 3: import local file → current vault
  type ImportStep = "idle" | "password" | "loading" | "done" | "error";
  const [importStep, setImportStep] = useState<ImportStep>("idle");
  const [importPath, setImportPath] = useState<string | null>(null);
  const [importPwd, setImportPwd] = useState("");
  const [showImportPwd, setShowImportPwd] = useState(false);
  const [importCount, setImportCount] = useState(0);
  const [importError, setImportError] = useState("");

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleExportLocal() {
    setExportStatus("loading"); setExportError("");
    try {
      const encrypted = await getEncryptedVault();
      const path = await pickSavePath("backup-cofre.keep");
      if (!path) { setExportStatus("idle"); return; }
      await writeVaultFile(path, encrypted);
      setExportStatus("done");
      setTimeout(() => setExportStatus("idle"), 2500);
    } catch (err) {
      setExportError(String(err));
      setExportStatus("error");
    }
  }

  async function handleDownloadFromDrive() {
    setDownloadStatus("loading"); setDownloadError("");
    try {
      const token = await ensureValidToken();
      if (!driveFileId) throw new Error("Nenhum cofre no Drive. Salve no Drive primeiro.");
      const encrypted = await downloadVaultFile(token, driveFileId);
      const path = await pickSavePath("backup-drive.keep");
      if (!path) { setDownloadStatus("idle"); return; }
      await writeVaultFile(path, encrypted);
      setDownloadStatus("done");
      setTimeout(() => setDownloadStatus("idle"), 2500);
    } catch (err) {
      setDownloadError(String(err));
      setDownloadStatus("error");
    }
  }

  async function handlePickImportFile() {
    const path = await pickOpenPath();
    if (!path) return;
    setImportPath(path);
    setImportPwd("");
    setImportError("");
    setImportStep("password");
  }

  async function handleImportFile() {
    if (!importPath || !importPwd) return;
    setImportStep("loading");
    try {
      const encrypted = await readVaultFile(importPath);
      const decrypted = await decryptVaultEnvelope(encrypted, importPwd);
      const otherVault = JSON.parse(decrypted.plaintext) as VaultData;
      const count = mergeFromVault(otherVault);
      setImportCount(count);
      setImportStep("done");
      if (googleToken) syncToCloud().catch(() => {});
      if (firebaseVaultId) syncToFirebase().catch(() => {});
    } catch (err) {
      const msg = String(err);
      setImportError(
        msg.toLowerCase().includes("decrypt") || msg.includes("tag") || msg.includes("cipher")
          ? "Senha mestra incorreta para este arquivo"
          : msg
      );
      setImportStep("error");
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-vault-card border border-vault-border rounded-2xl w-full max-w-sm mx-4 shadow-2xl animate-slide-up">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-vault-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-vault-primary/20 flex items-center justify-center">
              <RefreshCw size={18} className="text-vault-primary" />
            </div>
            <div>
              <h2 className="text-vault-text font-semibold">Backup & Sincronização</h2>
              <p className="text-vault-textMuted text-xs">Gerencie cópias do seu cofre</p>
            </div>
          </div>
          <button onClick={onClose} className="text-vault-textMuted hover:text-vault-text transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-3">

          {/* ── Panel 1: Export local copy ── */}
          <SimplePanel
            icon={<HardDrive size={15} className="text-vault-primary" />}
            title="Salvar cópia local"
            desc="Exportar o cofre atual para um arquivo .keep (não altera o arquivo principal)"
            status={exportStatus}
            error={exportError}
            actionLabel="Salvar cópia..."
            doneLabel="Cópia salva!"
            actionIcon={<Download size={13} />}
            onAction={handleExportLocal}
            onRetry={() => { setExportStatus("idle"); setExportError(""); }}
          />

          {/* ── Panel 2: Download Drive → local ── */}
          <SimplePanel
            icon={<Cloud size={15} className="text-blue-400" />}
            title="Baixar do Drive para local"
            desc="Baixar o cofre salvo no Google Drive e guardar como arquivo .keep"
            status={downloadStatus}
            error={downloadError}
            actionLabel="Baixar do Drive..."
            doneLabel="Arquivo salvo!"
            actionIcon={<Download size={13} />}
            onAction={handleDownloadFromDrive}
            onRetry={() => { setDownloadStatus("idle"); setDownloadError(""); }}
            disabled={!googleToken}
            disabledHint="Conecte ao Google Drive primeiro (menu Google Drive...)"
          />

          {/* ── Panel 3: Import local file → vault ── */}
          <div className="p-4 bg-vault-sidebar border border-vault-border rounded-xl space-y-3">
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-vault-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Upload size={14} className="text-vault-primary" />
              </div>
              <div>
                <p className="text-vault-text text-sm font-medium">Importar arquivo local</p>
                <p className="text-vault-textMuted text-xs leading-relaxed">
                  Selecionar um <code className="text-vault-primary">.keep</code> e mesclar suas senhas no cofre atual
                  {googleToken && " (sincroniza no Drive em seguida)"}
                </p>
              </div>
            </div>

            {importStep === "idle" && (
              <button onClick={handlePickImportFile}
                className="w-full py-2 bg-vault-card border border-vault-border hover:border-vault-primary/40 rounded-lg text-vault-textSecondary hover:text-vault-text text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
              >
                <FolderOpen size={13} /> Selecionar arquivo .keep...
              </button>
            )}

            {importStep === "password" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 bg-vault-card rounded-lg border border-vault-border">
                  <FolderOpen size={12} className="text-vault-primary flex-shrink-0" />
                  <p className="text-vault-textMuted text-xs truncate">{importPath}</p>
                </div>
                <div className="relative">
                  <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-vault-textMuted" />
                  <input
                    type={showImportPwd ? "text" : "password"}
                    value={importPwd}
                    onChange={(e) => setImportPwd(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleImportFile(); }}
                    placeholder="Senha mestra do arquivo"
                    autoFocus
                    className="w-full bg-vault-input border border-vault-border rounded-lg pl-8 pr-9 py-2 text-vault-text text-xs placeholder-vault-textMuted focus:outline-none focus:border-vault-primary transition-colors"
                  />
                  <button type="button" onClick={() => setShowImportPwd(!showImportPwd)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-vault-textMuted hover:text-vault-text"
                  >
                    {showImportPwd ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setImportStep("idle"); setImportPath(null); setImportPwd(""); }}
                    className="flex-1 py-1.5 bg-vault-card border border-vault-border rounded-lg text-vault-textMuted text-xs hover:text-vault-text transition-colors"
                  >
                    Cancelar
                  </button>
                  <button onClick={handleImportFile} disabled={!importPwd}
                    className="flex-1 py-1.5 bg-vault-primary hover:bg-vault-primaryHover disabled:opacity-40 rounded-lg text-vault-bg text-xs font-medium transition-colors flex items-center justify-center gap-1"
                  >
                    <Upload size={12} /> Importar
                  </button>
                </div>
              </div>
            )}

            {importStep === "loading" && (
              <div className="flex items-center justify-center gap-2 py-2 text-vault-textMuted text-xs">
                <Loader2 size={13} className="animate-spin" /> Importando senhas...
              </div>
            )}

            {importStep === "done" && (
              <div className="flex items-center gap-2 p-2.5 bg-vault-success/10 border border-vault-success/20 rounded-lg">
                <Check size={14} className="text-vault-success flex-shrink-0" />
                <p className="text-xs text-vault-success">
                  {importCount > 0
                    ? `${importCount} senha${importCount !== 1 ? "s" : ""} importada${importCount !== 1 ? "s" : ""}${googleToken ? " · sincronizando com Drive" : ""}`
                    : "Nenhuma senha nova encontrada (todas já existem no cofre)"}
                </p>
              </div>
            )}

            {importStep === "error" && (
              <div className="space-y-2">
                <div className="flex items-start gap-2 p-2.5 bg-vault-danger/10 border border-vault-danger/30 rounded-lg">
                  <AlertCircle size={13} className="text-vault-danger flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-vault-danger">{importError}</p>
                </div>
                <button onClick={() => { setImportStep("password"); setImportError(""); }}
                  className="w-full py-1.5 bg-vault-card border border-vault-border rounded-lg text-vault-textMuted text-xs hover:text-vault-text transition-colors"
                >
                  Tentar novamente
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── SimplePanel ──────────────────────────────────────────────────────────────

function SimplePanel({
  icon, title, desc, status, error,
  actionLabel, doneLabel, actionIcon,
  onAction, onRetry,
  disabled = false, disabledHint,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  status: PanelStatus;
  error: string;
  actionLabel: string;
  doneLabel: string;
  actionIcon: React.ReactNode;
  onAction: () => void;
  onRetry: () => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <div className="p-4 bg-vault-sidebar border border-vault-border rounded-xl space-y-3">
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-vault-card border border-vault-border flex items-center justify-center flex-shrink-0 mt-0.5">
          {icon}
        </div>
        <div>
          <p className="text-vault-text text-sm font-medium">{title}</p>
          <p className="text-vault-textMuted text-xs leading-relaxed">{desc}</p>
        </div>
      </div>

      {status === "idle" && !disabled && (
        <button onClick={onAction}
          className="w-full py-2 bg-vault-card border border-vault-border hover:border-vault-primary/40 rounded-lg text-vault-textSecondary hover:text-vault-text text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
        >
          {actionIcon} {actionLabel}
        </button>
      )}

      {status === "idle" && disabled && disabledHint && (
        <p className="text-vault-textMuted text-xs italic">{disabledHint}</p>
      )}

      {status === "loading" && (
        <div className="flex items-center justify-center gap-2 py-1.5 text-vault-textMuted text-xs">
          <Loader2 size={13} className="animate-spin" /> Aguarde...
        </div>
      )}

      {status === "done" && (
        <div className="flex items-center gap-2 p-2 bg-vault-success/10 border border-vault-success/20 rounded-lg">
          <Check size={13} className="text-vault-success flex-shrink-0" />
          <p className="text-xs text-vault-success">{doneLabel}</p>
        </div>
      )}

      {status === "error" && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 p-2.5 bg-vault-danger/10 border border-vault-danger/30 rounded-lg">
            <AlertCircle size={13} className="text-vault-danger flex-shrink-0 mt-0.5" />
            <p className="text-xs text-vault-danger">{error}</p>
          </div>
          <button onClick={onRetry}
            className="w-full py-1.5 bg-vault-card border border-vault-border rounded-lg text-vault-textMuted text-xs hover:text-vault-text transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      )}
    </div>
  );
}
