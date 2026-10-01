import { useState } from "react";
import {
  ShieldCheck, Eye, EyeOff, Lock, Plus, AlertCircle, Loader2,
  FolderOpen, Cloud, FileKey, ArrowRight, RefreshCw, Share2, Users,
} from "lucide-react";
import { usePlatform } from "../hooks/usePlatform";
import { useVaultStore } from "../store/vaultStore";
import {
  findAllVaultFiles, findAllCollaborativeVaultFiles, downloadVaultFile,
  startOAuthFlow, getUserInfo, getFileVersion,
} from "../services/googleDrive";
import { decryptVaultEnvelope } from "../services/crypto";
import { getMobileVaultPath, pickOpenPath, readVaultFile } from "../services/localFile";
import { PasswordEntry, PasswordGroup, VaultPermission } from "../types/vault";

type ScreenMode =
  | "quick"            // resume last known vault — just ask password
  | "choose"           // full picker
  | "new"              // create new vault
  | "pick-local"       // step 1: choose .keep file
  | "unlock-local"     // step 2: .keep path known, ask password
  | "pick-drive"       // step 1: connect + list Drive vaults
  | "unlock-drive"     // step 2: Drive file chosen, ask password
  | "connecting"       // waiting OAuth browser (for vault open)
  | "import-connect"   // waiting OAuth browser (for import flow)
  | "import-pick"      // list shared collaborative vaults
  | "import-unlock"    // enter share password to decrypt
  | "import-dest"      // choose destination (new vault / local / drive)
  | "import-new-vault"; // set master password for new vault

interface PendingShare {
  group: PasswordGroup | null;
  entries: PasswordEntry[];
  role: VaultPermission;
  sharedBy?: string;
}

function formatShareFileName(name: string): string {
  return name
    .replace(/^pk-collab-/, "")
    .replace(/-\d+\.keep$/, "")
    .replace(/\.keep$/, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function detectInitialMode(
  localVaultPath: string | null,
  googleToken: { expires_at: number } | null
): ScreenMode {
  if (localVaultPath) return "quick";
  if (googleToken && Date.now() < googleToken.expires_at - 60000) return "quick";
  return "choose";
}

export function MasterPasswordScreen() {
  const { isAndroid } = usePlatform();
  const {
    createVault, unlockVault, mergeSharedEntries,
    googleToken, userInfo,
    setGoogleToken, setUserInfo, setDriveFileId, setDriveRevision,
    localVaultPath, ensureValidToken, dismissedShareFileIds, dismissShareFile,
    addSharedSource, initDriveChangesToken,
  } = useVaultStore();

  const [mode, setMode] = useState<ScreenMode>(
    detectInitialMode(localVaultPath, googleToken)
  );
  const [masterPwd, setMasterPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Local flow
  const [pickedLocalPath, setPickedLocalPath] = useState<string | null>(null);

  // Drive vault selection
  const [driveVaults, setDriveVaults] = useState<{ id: string; name: string }[]>([]);
  const [selectedDriveFileId, setSelectedDriveFileId] = useState<string | null>(null);
  const [loadingDriveList, setLoadingDriveList] = useState(false);

  // Import share flow
  const [shareFiles, setShareFiles] = useState<{ id: string; name: string; ownerEmail?: string }[]>([]);
  const [selectedShareFileId, setSelectedShareFileId] = useState<string | null>(null);
  const [shareUnlockPwd, setShareUnlockPwd] = useState("");
  const [showSharePwd, setShowSharePwd] = useState(false);
  const [loadingShareList, setLoadingShareList] = useState(false);
  const [pendingShare, setPendingShare] = useState<PendingShare | null>(null);

  const quickSource: "local" | "drive" = localVaultPath ? "local" : "drive";
  const isImportFlow = pendingShare !== null;

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function friendlyError(err: unknown): string {
    const msg = String(err);
    if (msg.includes("sending request") || msg.includes("EAI_NONAME") || msg.includes("dns") || msg.includes("network") || msg.includes("UnknownHost")) {
      return "Sem acesso à rede. Verifique as permissões de internet do aplicativo nas configurações do Android.";
    }
    if (msg.includes("decrypt")) return "Senha incorreta";
    if (msg.includes("expirada") || msg.includes("autenticado")) return "Sessão expirada. Faça login novamente.";
    return msg;
  }

  function reset() {
    setError(""); setMasterPwd(""); setConfirmPwd(""); setPickedLocalPath(null); setSelectedDriveFileId(null);
  }

  function cancelImport() {
    setPendingShare(null);
    setShareFiles([]); setSelectedShareFileId(null); setShareUnlockPwd("");
    reset(); setMode("choose");
  }

  async function connectGoogle(purpose: "vault" | "import") {
    // Returns a valid token (silent refresh or new OAuth flow).
    // Sets connecting mode while browser is open.
    let token;
    if (googleToken) {
      try { return await ensureValidToken(); } catch { /* fall through to recover a durable session */ }
    }
    setMode(purpose === "vault" ? "connecting" : "import-connect");
    token = await startOAuthFlow(true);
    setGoogleToken(token);
    try {
      const info = await getUserInfo(token.access_token);
      setUserInfo(info);
    } catch {
      // getUserInfo pode falhar em Android com restrição de rede MIUI.
      // Não bloqueia o fluxo — userInfo é usado apenas para exibição.
    }
    return token;
  }

  // ─── Handlers ───────────────────────────────────────────────────────────────

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (masterPwd.length < 8) { setError("A senha mestra deve ter pelo menos 8 caracteres"); return; }
    if (masterPwd !== confirmPwd) { setError("As senhas não conferem"); return; }
    createVault(masterPwd);
  }

  async function handlePickLocalFile() {
    setError(""); setLoading(true);
    try {
      const path = isAndroid
        ? await getMobileVaultPath()
        : await pickOpenPath();
      if (!path) { setLoading(false); return; }
      setPickedLocalPath(path);
      setMode("unlock-local");
    } catch {
      setError(isAndroid ? "Nenhum cofre local encontrado neste dispositivo." : "Não foi possível selecionar o arquivo");
    }
    setLoading(false);
  }

  async function handleOpenLocalFile(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!masterPwd) { setError("Digite a senha mestra"); return; }
    const path = pickedLocalPath ?? localVaultPath;
    if (!path) { setMode("pick-local"); return; }
    setLoading(true);
    try {
      const encrypted = await readVaultFile(path);
      await unlockVault(encrypted, masterPwd);
      // Persistir o path para que o próximo quick unlock saiba qual arquivo abrir
      useVaultStore.getState().saveToLocalFile(path).catch(() => {});
      if (pendingShare) mergeSharedEntries(pendingShare.entries, pendingShare.group);
    } catch {
      setError("Senha incorreta ou arquivo inválido");
      setLoading(false);
    }
  }

  async function handleConnectDrive() {
    setError(""); setLoadingDriveList(true);
    try {
      const token = await connectGoogle("vault");
      setMode("pick-drive");
      const vaults = await findAllVaultFiles(token);
      setDriveVaults(vaults);
      if (vaults.length === 1) setSelectedDriveFileId(vaults[0].id);
    } catch (err) { setError(friendlyError(err)); setMode("choose"); }
    setLoadingDriveList(false);
  }

  async function handleOpenDriveFile(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!masterPwd) { setError("Digite a senha mestra"); return; }
    if (!selectedDriveFileId) { setError("Selecione um cofre"); return; }
    setLoading(true);
    try {
      const token = googleToken!;
      setDriveFileId(selectedDriveFileId);
      const encrypted = await downloadVaultFile(token, selectedDriveFileId);
      await unlockVault(encrypted, masterPwd);
      const revision = await getFileVersion(token, selectedDriveFileId);
      setDriveRevision(revision);
      // Inicializar polling de mudanças após abrir cofre do Drive
      await initDriveChangesToken();
      if (pendingShare) mergeSharedEntries(pendingShare.entries, pendingShare.group);
    } catch (err) {
      setError(friendlyError(err));
      setLoading(false);
    }
  }

  async function handleQuickUnlock(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!masterPwd) { setError("Digite a senha mestra"); return; }
    setLoading(true);
    if (quickSource === "local" && localVaultPath) {
      try {
        const encrypted = await readVaultFile(localVaultPath);
        await unlockVault(encrypted, masterPwd);
        // Garantir que o path continua persistido (não-destrutivo, sem re-salvar dados)
        useVaultStore.getState().saveToLocalFile(localVaultPath).catch(() => {});
      } catch {
        setError("Senha incorreta ou arquivo inválido");
        setLoading(false);
      }
    } else {
      try {
        const token = await ensureValidToken();
        const vaults = await findAllVaultFiles(token);
        if (vaults.length === 0) { setLoading(false); setMode("pick-drive"); setDriveVaults([]); return; }
        const fileId = vaults[0].id;
        setDriveFileId(fileId);
        const encrypted = await downloadVaultFile(token, fileId);
        await unlockVault(encrypted, masterPwd);
        const revision = await getFileVersion(token, fileId);
        setDriveRevision(revision);
        // Inicializar polling de mudanças após abrir cofre do Drive
        await initDriveChangesToken();
      } catch (err) {
        const msg = String(err);
        if (msg.includes("expirada") || msg.includes("autenticado")) {
          setLoading(false); handleConnectDrive();
        } else {
          setError(friendlyError(err));
          setLoading(false);
        }
      }
    }
  }

  // ── Import share handlers ─────────────────────────────────────────────────

  async function handleConnectForImport() {
    setError(""); setLoadingShareList(true);
    try {
      let token = await connectGoogle("import");
      setMode("import-pick");
      let files = (await findAllCollaborativeVaultFiles(token))
        .filter((file) => !dismissedShareFileIds.includes(file.id));
      if (files.length === 0 && googleToken) {
        token = await startOAuthFlow(false);
        setGoogleToken(token);
        try {
          const info = await getUserInfo(token.access_token);
          setUserInfo(info);
        } catch {
          setUserInfo(null);
        }
        files = (await findAllCollaborativeVaultFiles(token))
          .filter((file) => !dismissedShareFileIds.includes(file.id));
      }
      setShareFiles(files);
    } catch (err) { setError(friendlyError(err)); setMode("choose"); }
    setLoadingShareList(false);
  }

  async function handleImportDecrypt(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!shareUnlockPwd) { setError("Digite a senha do compartilhamento"); return; }
    if (!selectedShareFileId) { setError("Selecione um compartilhamento"); return; }
    setLoading(true);
    try {
      const token = await ensureValidToken();
      const encrypted = await downloadVaultFile(token, selectedShareFileId);

      // Decriptar para extrair as entradas e levá-las para o destino escolhido
      const opened = await decryptVaultEnvelope(encrypted, shareUnlockPwd);
      const remoteData = JSON.parse(opened.plaintext) as { entries?: unknown[]; groups?: unknown[]; owner?: string; collaboration?: unknown; sharedWith?: unknown[] };
      const revision = await getFileVersion(token, selectedShareFileId);
      setDriveRevision(revision);

      // Identificar grupo e entradas do compartilhamento para o fluxo de importação
      const groups = (remoteData.groups ?? []) as import("../types/vault").PasswordGroup[];
      const entries = (remoteData.entries ?? []) as import("../types/vault").PasswordEntry[];
      const group = groups.length === 1 ? groups[0] : null;
      const role = (remoteData.sharedWith as import("../types/vault").SharedUser[] | undefined)
        ?.find((u) => useVaultStore.getState().userInfo?.email === u.email)?.role ?? "reader";

      setPendingShare({ entries, group, role, sharedBy: remoteData.owner });
      setLoading(false);
      setMode("import-dest");
    } catch (err) {
      const msg = String(err);
      if (msg.toLowerCase().includes("decrypt") || msg.includes("tag") || msg.includes("cipher") || msg.includes("Senha")) {
        setError("Senha do compartilhamento incorreta");
      } else { setError(friendlyError(err)); }
      setLoading(false);
    }
  }

  async function handleImportToNewVault(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (masterPwd.length < 8) { setError("A senha mestra deve ter pelo menos 8 caracteres"); return; }
    if (masterPwd !== confirmPwd) { setError("As senhas não conferem"); return; }
    if (!pendingShare) return;
    createVault(masterPwd);
    mergeSharedEntries(pendingShare.entries, pendingShare.group);
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={`min-h-screen bg-vault-bg flex flex-col ${isAndroid ? "pt-10 pb-6 px-4" : "items-center justify-center p-4"}`}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-vault-primary/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-vault-secondary/8 rounded-full blur-3xl" />
      </div>

      <div className={`relative w-full ${isAndroid ? "flex flex-col flex-1" : "max-w-md"}`}>
        {/* Logo */}
        <div className={`text-center ${isAndroid ? "mb-5 mt-2" : "mb-8"}`}>
          <div className={`${isAndroid ? "w-14 h-14" : "w-20 h-20"} rounded-3xl bg-gradient-to-br from-vault-primary to-vault-secondary flex items-center justify-center mx-auto ${isAndroid ? "mb-3" : "mb-4"} shadow-2xl shadow-vault-primary/30`}>
            <ShieldCheck size={isAndroid ? 26 : 36} className="text-vault-bg" />
          </div>
          <h1 className={`${isAndroid ? "text-2xl" : "text-3xl"} font-bold text-vault-text`}>Password Keeper</h1>
          <p className="text-vault-textMuted mt-1 text-sm">Seu cofre de senhas seguro</p>
        </div>

        <div className={`bg-vault-card border border-vault-border ${isAndroid ? "rounded-2xl p-5 flex-1" : "rounded-3xl p-8"} shadow-2xl`}>

          {/* ── Quick unlock ── */}
          {mode === "quick" && (
            <form onSubmit={handleQuickUnlock} className="space-y-5 animate-fade-in">
              <div className="flex items-center gap-3 p-3.5 bg-vault-sidebar border border-vault-border rounded-xl">
                {quickSource === "local" ? (
                  <>
                    <div className="w-9 h-9 rounded-lg bg-vault-primary/20 flex items-center justify-center flex-shrink-0">
                      <FileKey size={18} className="text-vault-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-vault-text text-sm font-medium">Arquivo local</p>
                      <p className="text-vault-textMuted text-xs truncate">{localVaultPath}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                      <GoogleIcon />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-vault-text text-sm font-medium">Google Drive</p>
                      <p className="text-vault-textMuted text-xs truncate">{userInfo?.email ?? "Conta conectada"}</p>
                    </div>
                  </>
                )}
              </div>

              <PasswordField label="Senha mestra" value={masterPwd} onChange={setMasterPwd} show={showPwd} onToggle={() => setShowPwd(!showPwd)} />
              {error && <ErrorMsg message={error} />}

              <button type="submit" disabled={loading} className="w-full py-3 bg-vault-primary hover:bg-vault-primaryHover disabled:opacity-40 rounded-xl text-vault-bg font-semibold transition-all hover:shadow-lg hover:shadow-vault-primary/30 flex items-center justify-center gap-2">
                {loading ? <><Loader2 size={18} className="animate-spin" /> Abrindo...</> : <><ArrowRight size={18} /> Abrir cofre</>}
              </button>

              <button type="button" onClick={() => { reset(); setMode("choose"); }} className="w-full text-center text-xs text-vault-textMuted hover:text-vault-textSecondary transition-colors py-1">
                Usar outro cofre
              </button>
            </form>
          )}

          {/* ── Choose ── */}
          {mode === "choose" && (
            <div className="space-y-3 animate-fade-in">
              <h2 className={`text-vault-text font-semibold text-center ${isAndroid ? "text-lg mb-4" : "text-xl mb-6"}`}>Como deseja começar?</h2>
              {error && <ErrorMsg message={error} />}
              <OptionButton icon={<Plus size={20} className="text-vault-primary" />} iconBg="bg-vault-primary/20"
                title="Criar novo cofre" subtitle="Comece do zero com um cofre vazio"
                onClick={() => { reset(); setMode("new"); }} />
              {!isAndroid && (
                <OptionButton icon={<FolderOpen size={20} className="text-vault-primary" />} iconBg="bg-vault-primary/20"
                  title="Abrir arquivo local" subtitle="Selecionar um arquivo .keep do computador"
                  onClick={() => { reset(); setMode("pick-local"); }} />
              )}
              {isAndroid && (
                <OptionButton icon={<FolderOpen size={20} className="text-vault-primary" />} iconBg="bg-vault-primary/20"
                  title="Abrir local"
                  subtitle={localVaultPath ? "Abrir o cofre salvo neste dispositivo" : "Abrir o cofre persistido no aparelho"}
                  onClick={() => { reset(); setMode("pick-local"); }} />
              )}
              <OptionButton icon={<GoogleIcon />} iconBg="bg-white/10"
                title="Abrir do Google Drive"
                subtitle={googleToken && userInfo ? `Conectado como ${userInfo.email}` : "Carregar cofre salvo na nuvem"}
                onClick={() => { reset(); handleConnectDrive(); }} />
              <OptionButton icon={<Share2 size={20} className="text-vault-primary" />} iconBg="bg-vault-primary/20"
                title="Abrir compartilhamento"
                subtitle="Abrir arquivo colaborativo compartilhado no Drive"
                onClick={() => { reset(); handleConnectForImport(); }} />
            </div>
          )}

          {/* ── New vault ── */}
          {mode === "new" && (
            <form onSubmit={handleCreate} className="space-y-4 animate-fade-in">
              <BackButton onClick={() => { reset(); setMode("choose"); }} />
              <h2 className="text-vault-text font-semibold text-lg">Criar Novo Cofre</h2>
              <div className="p-3 bg-vault-primary/10 border border-vault-primary/20 rounded-xl space-y-1.5">
                <p className="text-xs text-vault-textSecondary font-medium">Como funciona?</p>
                <p className="text-xs text-vault-textMuted leading-relaxed">
                  A senha mestra criptografa o arquivo <code className="text-vault-primary">.keep</code>. Ela não fica salva em nenhum servidor — só você a conhece.
                </p>
              </div>
              <PasswordField label="Senha mestra" value={masterPwd} onChange={setMasterPwd} show={showPwd} onToggle={() => setShowPwd(!showPwd)} placeholder="Mínimo 8 caracteres" />
              <PasswordField label="Confirmar senha" value={confirmPwd} onChange={setConfirmPwd} show={showPwd} onToggle={() => setShowPwd(!showPwd)} placeholder="Digite novamente" />
              {error && <ErrorMsg message={error} />}
              <button type="submit" className="w-full py-3 bg-vault-primary hover:bg-vault-primaryHover rounded-xl text-vault-bg font-semibold transition-all">
                Criar Cofre
              </button>
            </form>
          )}

          {/* ── Step 1: Pick local file ── */}
          {mode === "pick-local" && (
            <div className="space-y-4 animate-fade-in">
              <BackButton onClick={() => { reset(); setMode(isImportFlow ? "import-dest" : "choose"); }} />
              <h2 className="text-vault-text font-semibold text-lg">
                {isImportFlow ? "Abrir seu cofre local" : "Abrir Arquivo Local"}
              </h2>
              {isImportFlow && (
                <div className="p-3 bg-vault-primary/10 border border-vault-primary/20 rounded-xl text-xs text-vault-textSecondary">
                  As senhas importadas serão mescladas no seu cofre existente.
                </div>
              )}
              <p className="text-vault-textMuted text-sm">Selecione o arquivo <code className="text-vault-primary">.keep</code> no seu computador.</p>
              {isAndroid && (
                <p className="text-vault-textMuted text-sm">O app vai abrir automaticamente o cofre salvo neste dispositivo.</p>
              )}
              {error && <ErrorMsg message={error} />}
              <button onClick={handlePickLocalFile} disabled={loading} className="w-full py-3 bg-vault-primary hover:bg-vault-primaryHover disabled:opacity-40 rounded-xl text-vault-bg font-semibold transition-all flex items-center justify-center gap-2">
                {loading ? <><Loader2 size={18} className="animate-spin" /> Abrindo...</> : <><FolderOpen size={18} /> {isAndroid ? "Abrir cofre do dispositivo" : "Selecionar arquivo .keep"}</>}
              </button>
            </div>
          )}

          {/* ── Step 2: Password for local file ── */}
          {mode === "unlock-local" && (
            <form onSubmit={handleOpenLocalFile} className="space-y-4 animate-fade-in">
              <BackButton onClick={() => { reset(); setMode("pick-local"); }} />
              <div className="flex items-center gap-3 p-3 bg-vault-sidebar border border-vault-border rounded-xl">
                <div className="w-8 h-8 rounded-lg bg-vault-primary/20 flex items-center justify-center flex-shrink-0">
                  <FileKey size={16} className="text-vault-primary" />
                </div>
                <p className="text-vault-textMuted text-xs truncate flex-1">{pickedLocalPath}</p>
              </div>
              <PasswordField label="Senha mestra" value={masterPwd} onChange={setMasterPwd} show={showPwd} onToggle={() => setShowPwd(!showPwd)} />
              {error && <ErrorMsg message={error} />}
              <button type="submit" disabled={loading} className="w-full py-3 bg-vault-primary hover:bg-vault-primaryHover disabled:opacity-40 rounded-xl text-vault-bg font-semibold transition-all flex items-center justify-center gap-2">
                {loading ? <><Loader2 size={18} className="animate-spin" /> Abrindo...</> : <><ArrowRight size={18} /> {isImportFlow ? "Abrir e importar" : "Abrir cofre"}</>}
              </button>
            </form>
          )}

          {/* ── Connecting to Google (vault open) ── */}
          {(mode === "connecting" || mode === "import-connect") && (
            <div className="text-center py-8 animate-fade-in space-y-4">
              <div className="w-14 h-14 rounded-full border-2 border-vault-primary border-t-transparent animate-spin mx-auto" />
              <p className="text-vault-textSecondary text-sm font-medium">Aguardando autorização no Google...</p>
              {isAndroid && (
                <p className="text-vault-textMuted text-xs leading-relaxed px-2">
                  Após autorizar no navegador, toque em <strong className="text-vault-textSecondary">Recentes □</strong> e volte ao Password Keeper.
                </p>
              )}
            </div>
          )}

          {/* ── Step 1: Pick Drive vault ── */}
          {mode === "pick-drive" && (
            <div className="space-y-4 animate-fade-in">
              <BackButton onClick={() => { reset(); setMode(isImportFlow ? "import-dest" : "choose"); }} />
              <div className="flex items-center justify-between">
                <h2 className="text-vault-text font-semibold text-lg">
                  {isImportFlow ? "Abrir seu cofre no Drive" : "Cofres no Drive"}
                </h2>
                <button onClick={handleConnectDrive} disabled={loadingDriveList} className="text-vault-textMuted hover:text-vault-primary transition-colors" title="Atualizar lista">
                  <RefreshCw size={14} className={loadingDriveList ? "animate-spin" : ""} />
                </button>
              </div>
              {isImportFlow && (
                <div className="p-3 bg-vault-primary/10 border border-vault-primary/20 rounded-xl text-xs text-vault-textSecondary">
                  As senhas importadas serão mescladas no cofre selecionado.
                </div>
              )}
              {userInfo && <p className="text-vault-textMuted text-xs">Conta: {userInfo.email}</p>}
              {loadingDriveList ? (
                <div className="flex items-center justify-center py-6 gap-2 text-vault-textMuted text-sm">
                  <Loader2 size={16} className="animate-spin" /> Buscando cofres...
                </div>
              ) : driveVaults.length === 0 ? (
                <div className="text-center py-6">
                  <Cloud size={32} className="text-vault-textMuted mx-auto mb-2" />
                  <p className="text-vault-textSecondary text-sm font-medium">Nenhum cofre encontrado</p>
                  <p className="text-vault-textMuted text-xs mt-1">Crie um cofre e salve no Google Drive primeiro.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {driveVaults.map((v) => (
                    <button key={v.id}
                      onClick={() => { setSelectedDriveFileId(v.id); setMode("unlock-drive"); }}
                      className="w-full flex items-center gap-3 p-3 bg-vault-sidebar border border-vault-border hover:border-vault-primary/40 rounded-xl transition-colors text-left"
                    >
                      <div className="w-8 h-8 rounded-lg bg-vault-primary/20 flex items-center justify-center flex-shrink-0">
                        <FileKey size={16} className="text-vault-primary" />
                      </div>
                      <span className="text-vault-textSecondary text-sm">{v.name}</span>
                      <ArrowRight size={14} className="text-vault-textMuted ml-auto" />
                    </button>
                  ))}
                </div>
              )}
              {error && <ErrorMsg message={error} />}
            </div>
          )}

          {/* ── Step 2: Password for Drive vault ── */}
          {mode === "unlock-drive" && (
            <form onSubmit={handleOpenDriveFile} className="space-y-4 animate-fade-in">
              <BackButton onClick={() => { setMode("pick-drive"); setError(""); setMasterPwd(""); }} />
              <div className="flex items-center gap-3 p-3 bg-vault-sidebar border border-vault-border rounded-xl">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                  <GoogleIcon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-vault-text text-xs font-medium truncate">
                    {driveVaults.find(v => v.id === selectedDriveFileId)?.name ?? "Cofre no Drive"}
                  </p>
                  {userInfo && <p className="text-vault-textMuted text-xs truncate">{userInfo.email}</p>}
                </div>
              </div>
              <PasswordField label="Senha mestra" value={masterPwd} onChange={setMasterPwd} show={showPwd} onToggle={() => setShowPwd(!showPwd)} />
              {error && <ErrorMsg message={error} />}
              <button type="submit" disabled={loading} className="w-full py-3 bg-vault-primary hover:bg-vault-primaryHover disabled:opacity-40 rounded-xl text-vault-bg font-semibold transition-all flex items-center justify-center gap-2">
                {loading ? <><Loader2 size={18} className="animate-spin" /> Abrindo...</> : <><ArrowRight size={18} /> {isImportFlow ? "Abrir e importar" : "Abrir cofre"}</>}
              </button>
            </form>
          )}

          {/* ── Open shared collaborative vault ── */}
          {mode === "import-pick" && (
            <div className="space-y-4 animate-fade-in">
              <BackButton onClick={() => { cancelImport(); }} />
              <div className="flex items-center justify-between">
                <h2 className="text-vault-text font-semibold text-lg">Compartilhamentos recebidos</h2>
                <button onClick={handleConnectForImport} disabled={loadingShareList} className="text-vault-textMuted hover:text-vault-primary transition-colors" title="Atualizar">
                  <RefreshCw size={14} className={loadingShareList ? "animate-spin" : ""} />
                </button>
              </div>
              {userInfo && <p className="text-vault-textMuted text-xs">Conta: {userInfo.email}</p>}
              {shareFiles.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    shareFiles.forEach((file) => dismissShareFile(file.id));
                    setShareFiles([]);
                  }}
                  className="w-full py-2 bg-vault-sidebar border border-vault-border rounded-xl text-vault-textMuted hover:text-vault-danger text-xs transition-colors"
                >
                  Ocultar todos os convites desta lista
                </button>
              )}
              {loadingShareList ? (
                <div className="flex items-center justify-center py-6 gap-2 text-vault-textMuted text-sm">
                  <Loader2 size={16} className="animate-spin" /> Buscando compartilhamentos...
                </div>
              ) : shareFiles.length === 0 ? (
                <div className="text-center py-6">
                  <Users size={32} className="text-vault-textMuted mx-auto mb-2" />
                  <p className="text-vault-textSecondary text-sm font-medium">Nenhum compartilhamento encontrado</p>
                  <p className="text-vault-textMuted text-xs mt-1">Peça ao proprietario para compartilhar com o seu email Google.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {shareFiles.map((f) => (
                    <div key={f.id} className="w-full flex items-center gap-3 p-3 bg-vault-sidebar border border-vault-border hover:border-vault-primary/40 rounded-xl transition-colors text-left">
                      <div className="w-8 h-8 rounded-lg bg-vault-primary/20 flex items-center justify-center flex-shrink-0">
                        <Share2 size={16} className="text-vault-primary" />
                      </div>
                      <button
                        onClick={() => { setSelectedShareFileId(f.id); setMode("import-unlock"); }}
                        className="flex-1 min-w-0 text-left"
                      >
                        <p className="text-vault-textSecondary text-sm truncate">{formatShareFileName(f.name)}</p>
                        <p className="text-vault-textMuted text-xs">
                          {f.ownerEmail ? `Compartilhado por ${f.ownerEmail}` : "Convite de colaboração"}
                        </p>
                      </button>
                      <button
                        onClick={() => {
                          dismissShareFile(f.id);
                          setShareFiles((files) => files.filter((file) => file.id !== f.id));
                        }}
                        className="px-2 py-1 rounded-lg text-xs text-vault-textMuted hover:text-vault-danger hover:bg-vault-danger/10"
                      >
                        Ocultar
                      </button>
                      <ArrowRight size={14} className="text-vault-textMuted" />
                    </div>
                  ))}
                </div>
              )}
              {error && <ErrorMsg message={error} />}
            </div>
          )}

          {/* ── Shared vault password ── */}
          {mode === "import-unlock" && (
            <form onSubmit={handleImportDecrypt} className="space-y-4 animate-fade-in">
              <BackButton onClick={() => { setError(""); setMode("import-pick"); }} />
              <h2 className="text-vault-text font-semibold text-lg">Senha do compartilhamento</h2>
              <div className="flex items-center gap-3 p-3 bg-vault-sidebar border border-vault-border rounded-xl">
                <div className="w-8 h-8 rounded-lg bg-vault-primary/20 flex items-center justify-center flex-shrink-0">
                  <Share2 size={16} className="text-vault-primary" />
                </div>
                <p className="text-vault-textMuted text-xs truncate flex-1">
                  {shareFiles.find(f => f.id === selectedShareFileId)?.name}
                </p>
              </div>
              <p className="text-vault-textMuted text-xs">Insira a senha enviada pelo proprietario.</p>
              <PasswordField label="Senha do compartilhamento" value={shareUnlockPwd} onChange={setShareUnlockPwd} show={showSharePwd} onToggle={() => setShowSharePwd(!showSharePwd)} placeholder="Senha fornecida pelo proprietario" />
              {error && <ErrorMsg message={error} />}
              <button type="submit" disabled={loading} className="w-full py-3 bg-vault-primary hover:bg-vault-primaryHover disabled:opacity-40 rounded-xl text-vault-bg font-semibold transition-all flex items-center justify-center gap-2">
                {loading ? <><Loader2 size={18} className="animate-spin" /> Abrindo...</> : <><ArrowRight size={18} /> Abrir compartilhamento</>}
              </button>
            </form>
          )}

          {/* ── Import: choose destination ── */}
          {mode === "import-dest" && pendingShare && (
            <div className="space-y-4 animate-fade-in">
              <BackButton onClick={() => { setMode("import-unlock"); setError(""); }} />
              <h2 className="text-vault-text font-semibold text-lg">Onde salvar as senhas?</h2>

              {/* Preview */}
              <div className="p-4 bg-vault-primary/10 border border-vault-primary/20 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-vault-primary text-sm font-medium">
                  <Share2 size={15} />
                  {pendingShare.entries.length} senha{pendingShare.entries.length !== 1 ? "s" : ""} prontas para importar
                </div>
                {pendingShare.group && (
                  <p className="text-vault-textMuted text-xs">Grupo: <span className="text-vault-textSecondary">{pendingShare.group.name}</span></p>
                )}
                {pendingShare.sharedBy && (
                  <p className="text-vault-textMuted text-xs">Compartilhado por: <span className="text-vault-textSecondary">{pendingShare.sharedBy}</span></p>
                )}
                <p className="text-vault-textMuted text-xs">
                  Acesso: <span className="text-vault-primary font-medium capitalize">{
                    pendingShare.role === "reader" ? "Somente leitura" :
                    pendingShare.role === "editor" ? "Editor" : "Proprietário"
                  }</span>
                </p>
              </div>

              <div className="space-y-2">
                <OptionButton icon={<Plus size={20} className="text-vault-primary" />} iconBg="bg-vault-primary/20"
                  title="Criar novo cofre"
                  subtitle="Importar em um cofre novo, sem senha existente"
                  onClick={() => { reset(); setMode("import-new-vault"); }} />
                <OptionButton icon={<FolderOpen size={20} className="text-vault-primary" />} iconBg="bg-vault-primary/20"
                  title="Mesclar em cofre local"
                  subtitle="Selecionar meu arquivo .keep existente"
                  onClick={() => { reset(); setMode("pick-local"); }} />
                <OptionButton icon={<GoogleIcon />} iconBg="bg-white/10"
                  title="Mesclar em cofre do Drive"
                  subtitle="Selecionar meu cofre salvo na nuvem"
                  onClick={() => { reset(); handleConnectDrive(); }} />
              </div>

              <button type="button" onClick={cancelImport} className="w-full text-center text-xs text-vault-textMuted hover:text-vault-danger transition-colors py-1">
                Cancelar importação
              </button>
            </div>
          )}

          {/* ── Import: new vault master password ── */}
          {mode === "import-new-vault" && pendingShare && (
            <form onSubmit={handleImportToNewVault} className="space-y-4 animate-fade-in">
              <BackButton onClick={() => { reset(); setMode("import-dest"); }} />
              <h2 className="text-vault-text font-semibold text-lg">Criar cofre com as senhas importadas</h2>
              <div className="p-3 bg-vault-primary/10 border border-vault-primary/20 rounded-xl text-xs text-vault-textSecondary">
                Defina a senha mestra para o novo cofre. Ela criptografará suas senhas e nunca sai do dispositivo.
              </div>
              <PasswordField label="Senha mestra" value={masterPwd} onChange={setMasterPwd} show={showPwd} onToggle={() => setShowPwd(!showPwd)} placeholder="Mínimo 8 caracteres" />
              <PasswordField label="Confirmar senha" value={confirmPwd} onChange={setConfirmPwd} show={showPwd} onToggle={() => setShowPwd(!showPwd)} placeholder="Digite novamente" />
              {error && <ErrorMsg message={error} />}
              <button type="submit" className="w-full py-3 bg-vault-primary hover:bg-vault-primaryHover rounded-xl text-vault-bg font-semibold transition-all flex items-center justify-center gap-2">
                <ArrowRight size={18} /> Criar e importar {pendingShare.entries.length} senha{pendingShare.entries.length !== 1 ? "s" : ""}
              </button>
            </form>
          )}

        </div>

        <p className="text-center text-vault-textMuted text-xs mt-6">
          Criptografado com AES-256-GCM · A senha mestra nunca sai do dispositivo
        </p>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

function OptionButton({ icon, iconBg, title, subtitle, onClick }: {
  icon: React.ReactNode; iconBg: string; title: string; subtitle: string; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className="w-full flex items-center gap-4 p-4 bg-vault-sidebar hover:bg-vault-card border border-vault-border hover:border-vault-primary/40 rounded-2xl transition-all group text-left"
    >
      <div className={`w-11 h-11 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}>
        {icon}
      </div>
      <div>
        <p className="text-vault-text font-semibold text-sm">{title}</p>
        <p className="text-vault-textMuted text-xs mt-0.5">{subtitle}</p>
      </div>
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-vault-textMuted hover:text-vault-text transition-colors text-sm flex items-center gap-1">
      ← Voltar
    </button>
  );
}

function PasswordField({ label, value, onChange, show, onToggle, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  show: boolean; onToggle: () => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-vault-textSecondary mb-1.5">{label}</label>
      <div className="relative">
        <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-vault-textMuted" />
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "••••••••"}
          autoFocus
          className="w-full bg-vault-input border border-vault-border rounded-xl pl-10 pr-11 py-3 text-vault-text placeholder-vault-textMuted focus:outline-none focus:border-vault-primary transition-colors"
        />
        <button type="button" onClick={onToggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-vault-textMuted hover:text-vault-text transition-colors">
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

function ErrorMsg({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 p-3 bg-vault-danger/10 border border-vault-danger/30 rounded-xl">
      <AlertCircle size={15} className="text-vault-danger mt-0.5 flex-shrink-0" />
      <p className="text-sm text-vault-danger">{message}</p>
    </div>
  );
}
