import { useState } from "react";
import { X, Cloud, LogIn, LogOut, RefreshCw, Check, AlertCircle, HardDrive } from "lucide-react";
import { useVaultStore } from "../store/vaultStore";
import { startOAuthFlow, getUserInfo, findVaultFile } from "../services/googleDrive";

interface GoogleDriveModalProps {
  onClose: () => void;
}

export function GoogleDriveModal({ onClose }: GoogleDriveModalProps) {
  const {
    googleToken, userInfo, driveFileId, isSyncing, lastSyncAt, syncError,
    setGoogleToken, setUserInfo, setDriveFileId,
    syncToCloud, loadFromCloud, unlockVault, masterPassword, ensureValidToken,
    initDriveChangesToken,
  } = useVaultStore();

  const [step, setStep] = useState<"main" | "loading">("main");
  const [error, setError] = useState("");
  const [showLoadConfirm, setShowLoadConfirm] = useState(false);

  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Tempo esgotado aguardando autorização do Google. Tente novamente.")),
        ms,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  async function handleConnect() {
    setStep("loading");
    setError("");
    try {
      let token;
      if (googleToken) {
        try {
          token = await withTimeout(ensureValidToken(), 125000);
        } catch {
          token = await withTimeout(startOAuthFlow(true), 125000);
        }
      } else {
        token = await withTimeout(startOAuthFlow(true), 125000);
      }
      setGoogleToken(token);
      try {
        const info = await getUserInfo(token.access_token);
        setUserInfo(info);
      } catch {
        setUserInfo(null);
      }
      // Only look for a regular vault file if the current vault is not a collab vault.
      // If it IS a collab vault, driveFileId already points to the collab file — keep it.
      const { vault, driveFileId: currentFileId } = useVaultStore.getState();
      if (!vault?.collaboration) {
        const fileId = await findVaultFile(token);
        if (fileId) setDriveFileId(fileId);
      } else if (!currentFileId) {
        const fileId = await findVaultFile(token);
        if (fileId) setDriveFileId(fileId);
      }
      // Inicializar polling de mudanças após conectar
      await initDriveChangesToken();
      setStep("main");
    } catch (err) {
      setError(String(err));
      setStep("main");
    }
  }

  function handleDisconnect() {
    setGoogleToken(null);
    setUserInfo(null);
    setDriveFileId(null);
  }

  async function handleSync() {
    setError("");
    try { await syncToCloud(); } catch (err) { setError(String(err)); }
  }

  async function handleLoad() {
    setShowLoadConfirm(false);
    setError("");
    try {
      const encrypted = await loadFromCloud();
      await unlockVault(encrypted, masterPassword);
      // Inicializar polling após carregar cofre do Drive
      await initDriveChangesToken();
    } catch (err) {
      setError(String(err));
    }
  }

  const isConnected = !!googleToken;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-vault-card border border-vault-border rounded-2xl w-full max-w-sm mx-4 shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-vault-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Cloud size={18} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-vault-text font-semibold">Google Drive</h2>
              <p className="text-vault-textMuted text-xs">Sincronização na nuvem</p>
            </div>
          </div>
          <button onClick={onClose} className="text-vault-textMuted hover:text-vault-text transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">

          {step === "loading" && (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-full border-2 border-blue-400 border-t-transparent animate-spin mx-auto mb-4" />
              <p className="text-vault-text font-medium">Aguardando autorização...</p>
              <p className="text-vault-textMuted text-sm mt-1">O navegador foi aberto para autenticação</p>
            </div>
          )}

          {step === "main" && (
            <>
              {/* Status */}
              {isConnected ? (
                <div className="p-4 bg-vault-success/10 border border-vault-success/20 rounded-xl flex items-center gap-3">
                  {userInfo?.picture ? (
                    <img src={userInfo.picture} alt="" className="w-10 h-10 rounded-full ring-2 ring-vault-success/30" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-vault-success/30 flex items-center justify-center">
                      <Check size={20} className="text-vault-success" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-vault-text font-medium text-sm truncate">{userInfo?.name ?? "Conectado"}</p>
                    <p className="text-vault-textMuted text-xs truncate">{userInfo?.email}</p>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-vault-sidebar border border-vault-border rounded-xl text-center">
                  <Cloud size={28} className="text-vault-textMuted mx-auto mb-2" />
                  <p className="text-vault-textSecondary text-sm">Não conectado ao Google Drive</p>
                  <p className="text-vault-textMuted text-xs mt-1">Clique em "Entrar com Google" para conectar</p>
                </div>
              )}

              {/* Vault in drive */}
              {isConnected && (
                <div className="flex items-center gap-3 p-3 bg-vault-sidebar border border-vault-border rounded-xl">
                  <HardDrive size={16} className={driveFileId ? "text-vault-success" : "text-vault-textMuted"} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-vault-text">
                      {driveFileId ? "Cofre encontrado no Drive" : "Nenhum cofre no Drive ainda"}
                    </p>
                    {lastSyncAt && (
                      <p className="text-xs text-vault-textMuted truncate">
                        Sincronizado: {new Date(lastSyncAt).toLocaleString("pt-BR")}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Error */}
              {(error || syncError) && (
                <div className="p-3 bg-vault-danger/10 border border-vault-danger/30 rounded-xl flex items-start gap-2">
                  <AlertCircle size={15} className="text-vault-danger mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-vault-danger">{error || syncError}</p>
                </div>
              )}

              {/* Load confirm */}
              {showLoadConfirm && (
                <div className="p-3 bg-vault-warning/10 border border-vault-warning/30 rounded-xl">
                  <p className="text-sm text-vault-warning font-medium mb-1">Confirmar carregamento</p>
                  <p className="text-xs text-vault-textMuted mb-3">O cofre atual será substituído pelo do Drive.</p>
                  <div className="flex gap-2">
                    <button onClick={() => setShowLoadConfirm(false)} className="flex-1 py-1.5 bg-vault-card border border-vault-border rounded-lg text-vault-textMuted text-sm">Cancelar</button>
                    <button onClick={handleLoad} className="flex-1 py-1.5 bg-vault-warning/20 border border-vault-warning/40 rounded-lg text-vault-warning text-sm font-medium">Confirmar</button>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2">
                {!isConnected ? (
                  <button
                    onClick={handleConnect}
                    className="w-full py-3 bg-white hover:bg-gray-100 rounded-xl text-gray-800 font-semibold transition-colors flex items-center justify-center gap-3 shadow-sm"
                  >
                    {/* Google G logo */}
                    <svg width="18" height="18" viewBox="0 0 48 48">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                    </svg>
                    Entrar com Google
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleSync}
                      disabled={isSyncing}
                      className="w-full py-2.5 bg-vault-primary hover:bg-vault-primaryHover disabled:opacity-40 rounded-xl text-white font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      <RefreshCw size={16} className={isSyncing ? "animate-spin" : ""} />
                      {isSyncing ? "Sincronizando..." : "Salvar no Drive"}
                    </button>

                    {driveFileId && (
                      <button
                        onClick={() => setShowLoadConfirm(true)}
                        className="w-full py-2.5 bg-vault-sidebar border border-vault-border hover:border-vault-primary rounded-xl text-vault-textSecondary hover:text-vault-text font-medium transition-colors flex items-center justify-center gap-2"
                      >
                        <Cloud size={16} /> Carregar do Drive
                      </button>
                    )}

                    <button
                      onClick={handleDisconnect}
                      className="w-full py-2 text-vault-textMuted hover:text-vault-danger text-sm transition-colors flex items-center justify-center gap-1.5"
                    >
                      <LogOut size={13} /> Desconectar conta
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
