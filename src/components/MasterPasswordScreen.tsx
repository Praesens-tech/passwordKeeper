import { useState } from "react";
import { Plus, FolderOpen, Cloud, FileKey, ArrowRight, Loader2, KeyRound } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { usePlatform } from "../hooks/usePlatform";
import { useVaultStore } from "../store/vaultStore";
import { getMobileVaultPath, pickOpenPath, pickSavePath, readVaultFile } from "../services/localFile";

type ScreenMode = "choose" | "quick" | "new" | "local" | "cloud" | "cloudNew";

export function MasterPasswordScreen() {
  const { isAndroid } = usePlatform();
  const store = useVaultStore();
  const [mode, setMode] = useState<ScreenMode>(store.storageMode === "cloud" ? "choose" : store.localVaultPath ? "quick" : "choose");
  const [masterPwd, setMasterPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [vaultName, setVaultName] = useState("Meu cofre");
  const [cloudVaultName, setCloudVaultName] = useState("Meu cofre");
  const [accountEmail, setAccountEmail] = useState(store.firebaseAccount?.email ?? "");
  const [accountPassword, setAccountPassword] = useState("");
  const [createAccount, setCreateAccount] = useState(false);
  const [path, setPath] = useState<string | null>(store.localVaultPath);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  function back() { setMode("choose"); setMasterPwd(""); setError(""); setNotice(""); }
  async function openLocal() {
    setError(""); setBusy(true);
    try {
      const selected = isAndroid ? await getMobileVaultPath() : await pickOpenPath();
      if (selected) { setPath(selected); setMode("local"); }
    } catch { setError("Não foi possível selecionar um cofre local."); }
    finally { setBusy(false); }
  }
  async function unlock(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const selected = path ?? store.localVaultPath;
      if (!selected) throw new Error("Selecione um arquivo .keep.");
      await store.unlockVault(await readVaultFile(selected), masterPwd);
      store.persistLocalVaultPath(selected);
    } catch { setError("Senha mestra incorreta ou arquivo inválido."); }
    finally { setBusy(false); }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (masterPwd.length < 12) throw new Error("Use uma senha mestra com pelo menos 12 caracteres.");
      if (masterPwd !== confirmPwd) throw new Error("As senhas não conferem.");
      if (!vaultName.trim()) throw new Error("Digite um nome para o cofre.");
      const fileName = vaultName.trim().replace(/[\\/:*?"<>|]/g, "-") + ".keep";
      const savePath = isAndroid ? await getMobileVaultPath(vaultName) : await pickSavePath(fileName);
      if (!savePath) return;
      store.createVault(masterPwd, vaultName.trim());
      await store.saveToLocalFile(savePath);
    } catch (e) { setError(String(e).replace(/^Error:\s*/, "")); }
    finally { setBusy(false); }
  }
  async function restore(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      if (createAccount) {
        if (accountPassword.length < 12) throw new Error("Use uma senha de conta com pelo menos 12 caracteres.");
        await store.createAccount(accountEmail, accountPassword);
        setCreateAccount(false); setAccountPassword("");
        setNotice("Enviamos um link de confirmação. Confirme o e-mail e depois entre para restaurar.");
      } else {
        if (!useVaultStore.getState().firebaseAccount) await store.signInAccount(accountEmail, accountPassword);
        await store.restoreFirebaseBackup(masterPwd);
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "auth/email-already-in-use") {
        setCreateAccount(false); setAccountPassword("");
        setError("Esta conta já existe. Entre com ela ou use “Esqueci a senha da conta” para redefinir a senha.");
      } else if (String(e).includes("OperationError")) {
        setError("Não foi possível descriptografar o backup. Confira a senha mestra usada nesse cofre; ela é diferente da senha da conta. A senha mestra não pode ser recuperada pelo Password Keeper.");
      } else setError(String(e).replace(/^Error:\s*/, ""));
    }
    finally { setBusy(false); }
  }
  async function resetAccountPassword() {
    setError(""); setNotice(""); setBusy(true);
    try {
      if (!accountEmail.trim()) throw new Error("Informe o e-mail da conta para receber o link de redefinição.");
      await store.resetAccountPassword(accountEmail);
      setNotice("Enviamos um link para redefinir a senha da conta. Isso não altera a senha mestra do cofre.");
    } catch { setError("Não foi possível enviar o link. Confira o e-mail e tente novamente."); }
    finally { setBusy(false); }
  }
  async function createCloudVault(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    let vaultCreated = false;
    try {
      if (!useVaultStore.getState().firebaseAccount) await store.signInAccount(accountEmail, accountPassword);
      if (masterPwd.length < 12) throw new Error("Use uma senha mestra com pelo menos 12 caracteres.");
      if (!cloudVaultName.trim()) throw new Error("Digite um nome para o cofre.");
      store.createVault(masterPwd, cloudVaultName.trim());
      vaultCreated = true;
      store.setStorageMode("cloud");
      await store.syncToFirebase();
    } catch (e) {
      const message = String(e).replace(/^Error:\s*/, "");
      if (vaultCreated) {
        store.setStorageMode("local");
        const explanation = message.includes("CONFLICT")
          ? "Já existe um backup nessa conta. Restaure esse cofre ou entre na conta correta; o backup não foi substituído."
          : "Não foi possível enviar o cofre. Confira a conexão e o acesso da conta; nenhum backup existente foi alterado.";
        useVaultStore.setState({ syncError: `${explanation} O cofre criado continua aberto; salve uma cópia local antes de fechar.` });
      } else setError(message);
    }
    finally { setBusy(false); }
  }

  async function openAccountDeletion() {
    await invoke("open_url", { url: "https://passwordkeeper.praesens.tech/excluir-conta.html" });
  }

  const inputClass = "mt-1 w-full rounded-xl border border-vault-border bg-vault-input px-3 py-3 text-sm text-vault-text placeholder-vault-textMuted focus:border-vault-primary focus:outline-none";
  const buttonClass = "flex w-full items-center justify-center gap-2 rounded-xl bg-vault-primary py-3 font-semibold text-vault-bg disabled:opacity-40";
  const option = (icon: React.ReactNode, title: string, subtitle: string, click: () => void) =>
    <button type="button" onClick={click} className="flex w-full items-center gap-3 rounded-xl border border-vault-border bg-vault-sidebar p-3.5 text-left hover:border-vault-primary/40">
      <span className="text-vault-primary">{icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-vault-text">{title}</span><span className="block truncate text-xs text-vault-textMuted">{subtitle}</span></span><ArrowRight size={14} className="text-vault-textMuted" />
    </button>;

  return <main className={"min-h-screen bg-vault-bg flex flex-col " + (isAndroid ? "px-4 pt-10 pb-6" : "items-center justify-center p-4")}>
    <div className={"w-full " + (isAndroid ? "flex flex-1 flex-col" : "max-w-md")}>
      <header className="mb-6 text-center"><div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-lg border border-vault-border bg-white p-3"><img src="/assets/praesens_simbolo.svg" alt="Praesens" className="h-full w-full object-contain" /></div><h1 className="text-2xl font-bold text-vault-text">Password Keeper</h1><p className="mt-1 text-sm text-vault-textMuted">Escolha entre guardar o cofre localmente ou na nuvem com compartilhamento.</p></header>
      <section className="rounded-2xl border border-vault-border bg-vault-card p-5 shadow-2xl">
        {mode === "choose" && <div className="space-y-3"><h2 className="mb-4 text-center text-lg font-semibold text-vault-text">Como deseja começar?</h2>
          {store.localVaultPath && option(<FileKey />, "Abrir cofre local", store.localVaultPath.split(/[\\/]/).pop() ?? "", () => setMode("quick"))}
          {option(<Plus />, "Criar novo cofre", "Criar e salvar um cofre neste dispositivo", () => setMode("new"))}
          {option(<FolderOpen />, "Abrir arquivo local", "Selecionar um arquivo .keep", () => void openLocal())}
          {option(<Cloud />, "Usar cofre na nuvem", "Restaurar um backup ou criar um cofre compartilhável", () => setMode("cloud"))}
        </div>}

        {(mode === "quick" || mode === "local") && <form onSubmit={unlock} className="space-y-4">
          <Back onClick={back} />{mode === "local" && <p className="text-xs text-vault-textMuted">{path}</p>}
          <label className="block text-sm text-vault-textSecondary">Senha mestra<input autoFocus type="password" autoComplete="current-password" className={inputClass} value={masterPwd} onChange={(e) => setMasterPwd(e.target.value)} /></label>
          {error && <ErrorMessage>{error}</ErrorMessage>}<button disabled={busy || !masterPwd} className={buttonClass}>{busy ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={17} />}Abrir cofre</button>
          {mode === "quick" && <button type="button" onClick={() => void openLocal()} className="w-full text-xs text-vault-textMuted">Abrir outro arquivo local</button>}
        </form>}

        {mode === "new" && <form onSubmit={create} className="space-y-3">
          <Back onClick={back} /><label className="block text-xs text-vault-textMuted">Nome do cofre<input className={inputClass} value={vaultName} onChange={(e) => setVaultName(e.target.value)} /></label>
          <label className="block text-xs text-vault-textMuted">Senha mestra<input type="password" autoComplete="new-password" className={inputClass} value={masterPwd} onChange={(e) => setMasterPwd(e.target.value)} /></label>
          <p className="text-xs text-vault-textMuted">Use pelo menos 12 caracteres. Essa senha criptografa o cofre e não é enviada à nuvem.</p>
          <label className="block text-xs text-vault-textMuted">Confirme a senha<input type="password" autoComplete="new-password" className={inputClass} value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} /></label>
          {error && <ErrorMessage>{error}</ErrorMessage>}<button disabled={busy} className={buttonClass}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Plus size={17} />}Criar cofre local</button>
        </form>}

        {mode === "cloud" && <form onSubmit={restore} className="space-y-3">
          <Back onClick={back} /><h2 className="text-center font-semibold text-vault-text">{createAccount ? "Criar conta Password Keeper" : "Restaurar backup criptografado"}</h2>
          {!useVaultStore.getState().firebaseAccount && <>
            <label className="block text-xs text-vault-textMuted">E-mail<input type="email" autoComplete="email" className={inputClass} value={accountEmail} onChange={(e) => setAccountEmail(e.target.value)} /></label>
            <label className="block text-xs text-vault-textMuted">Senha da conta<input type="password" autoComplete={createAccount ? "new-password" : "current-password"} className={inputClass} value={accountPassword} onChange={(e) => setAccountPassword(e.target.value)} /></label>
          </>}
          {!createAccount && <label className="block text-xs text-vault-textMuted">Senha mestra do cofre<input type="password" autoComplete="current-password" className={inputClass} value={masterPwd} onChange={(e) => setMasterPwd(e.target.value)} /></label>}
          {!createAccount && !useVaultStore.getState().firebaseAccount && <button type="button" onClick={() => void resetAccountPassword()} disabled={busy || !accountEmail.trim()} className="w-full text-left text-xs text-vault-primary hover:underline"><KeyRound size={12} className="mr-1 inline" />Esqueci a senha da conta</button>}
          {createAccount && <p className="text-xs text-vault-textMuted">Mínimo de 12 caracteres. Enviaremos um link para confirmar seu e-mail.</p>}
          {error && <ErrorMessage>{error}</ErrorMessage>}{notice && <p role="status" className="rounded-lg bg-vault-success/10 p-2.5 text-xs text-vault-success">{notice}</p>}
          <button disabled={busy || (!useVaultStore.getState().firebaseAccount && (!accountEmail || !accountPassword)) || (!createAccount && !masterPwd)} className={buttonClass}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Cloud size={17} />}{createAccount ? "Criar conta" : "Entrar e restaurar"}</button>
          {!useVaultStore.getState().firebaseAccount && <button type="button" onClick={() => { setCreateAccount(!createAccount); setError(""); setNotice(""); }} className="w-full text-xs text-vault-textMuted">{createAccount ? "Já tenho uma conta" : "Criar conta nova"}</button>}
          <button type="button" onClick={() => void openAccountDeletion()} className="w-full text-xs text-vault-textMuted hover:text-vault-danger">Solicitar exclusão da conta e dos dados</button>
          {!createAccount && <button type="button" onClick={() => { setMode("cloudNew"); setError(""); setNotice(""); }} className="w-full text-xs text-vault-primary hover:underline">Criar um cofre novo na nuvem</button>}
          <p className="text-center text-[11px] leading-relaxed text-vault-textMuted">A conta autoriza o acesso. A senha mestra descriptografa o cofre e nunca sai do dispositivo.</p>
        </form>}

        {mode === "cloudNew" && <form onSubmit={createCloudVault} className="space-y-3">
          <Back onClick={() => setMode("cloud")} /><h2 className="text-center font-semibold text-vault-text">Criar cofre na nuvem</h2>
          {!useVaultStore.getState().firebaseAccount && <>
            <label className="block text-xs text-vault-textMuted">E-mail da conta confirmada<input type="email" autoComplete="email" className={inputClass} value={accountEmail} onChange={(e) => setAccountEmail(e.target.value)} /></label>
            <label className="block text-xs text-vault-textMuted">Senha da conta<input type="password" autoComplete="current-password" className={inputClass} value={accountPassword} onChange={(e) => setAccountPassword(e.target.value)} /></label>
          </>}
          <label className="block text-xs text-vault-textMuted">Nome do cofre<input className={inputClass} value={cloudVaultName} onChange={(e) => setCloudVaultName(e.target.value)} /></label>
          <label className="block text-xs text-vault-textMuted">Senha mestra do cofre<input type="password" autoComplete="new-password" className={inputClass} value={masterPwd} onChange={(e) => setMasterPwd(e.target.value)} /></label>
          <p className="text-xs text-vault-textMuted">O cofre será criptografado antes do envio e não será salvo em arquivo local.</p>
          {error && <ErrorMessage>{error}</ErrorMessage>}
          <button disabled={busy || (!useVaultStore.getState().firebaseAccount && (!accountEmail || !accountPassword)) || masterPwd.length < 12} className={buttonClass}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Cloud size={17} />}Criar cofre na nuvem</button>
        </form>}
      </section>
    </div>
  </main>;
}
function Back({ onClick }: { onClick: () => void }) { return <button type="button" onClick={onClick} className="text-xs text-vault-textMuted hover:text-vault-text">← Voltar</button>; }
function ErrorMessage({ children }: { children: React.ReactNode }) { return <p role="alert" className="rounded-lg bg-vault-danger/10 p-2.5 text-xs text-vault-danger">{children}</p>; }
