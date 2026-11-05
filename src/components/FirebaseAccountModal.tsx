import { useState } from "react";
import { Cloud, LogOut, X, Loader2, ShieldCheck, KeyRound, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useVaultStore } from "../store/vaultStore";

export function FirebaseAccountModal({ onClose }: { onClose: () => void }) {
  const { firebaseAccount, firebaseBackupRevision, vault, storageMode, setStorageMode, clearSyncError, signInAccount, createAccount, signOutAccount, syncToFirebase, resetAccountPassword } = useVaultStore();
  const [mode, setMode] = useState<"signin" | "create">("signin");
  const [email, setEmail] = useState(firebaseAccount?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function openAccountDeletion() {
    await invoke("open_url", { url: "https://passwordkeeper.praesens.tech/excluir-conta.html" });
  }

  async function submit() {
    setBusy(true); setError(""); setMessage("");
    try {
      if (mode === "create") {
        if (password.length < 12) throw new Error("Use uma senha de conta com pelo menos 12 caracteres.");
        if (password !== confirmPassword) throw new Error("As senhas não conferem.");
        await createAccount(email, password);
        setMessage("Enviamos um link de confirmação. Confirme o e-mail e depois entre na conta.");
        setMode("signin"); setPassword(""); setConfirmPassword("");
      } else {
        await signInAccount(email, password);
        setPassword("");
        setMessage("Conta conectada. O cofre continua criptografado antes do envio.");
      }
    } catch (e) {
      if (mode === "create" && (e as { code?: string }).code === "auth/email-already-in-use") {
        setMode("signin"); setPassword(""); setConfirmPassword("");
        setError("Esta conta já existe. Entre com ela ou use “Esqueci a senha” para redefinir a senha da conta.");
      } else if ((e as { code?: string }).code === "auth/invalid-credential") {
        setError("E-mail ou senha da conta incorretos. Se esqueceu a senha, use “Esqueci a senha”.");
      } else setError(String(e).replace(/^Error:\s*/, ""));
    }
    finally { setBusy(false); }
  }

  async function backupNow() {
    setBusy(true); setError(""); setMessage("");
    try { await syncToFirebase(); setMessage("Backup criptografado enviado e verificado na nuvem."); }
    catch (e) { setError(String(e).replace(/^Error:\s*/, "")); }
    finally { setBusy(false); }
  }

  async function switchToCloud() {
    setBusy(true); setError(""); setMessage("");
    setStorageMode("cloud");
    try {
      await syncToFirebase();
      setMessage("Cofre enviado à nuvem e sincronizado. O arquivo local existente foi mantido como cópia.");
    } catch (e) {
      setStorageMode("local");
      clearSyncError();
      const message = String(e).replace(/^Error:\s*/, "");
      setError(message.includes("CONFLICT")
        ? "Já existe um backup nessa conta. Restaure esse cofre ou escolha a conta correta; nada foi substituído. O cofre atual continua no modo Local."
        : "Não foi possível enviar o cofre. Confira a conexão e as permissões da conta; o modo Local foi mantido.");
    } finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);
    try { await signOutAccount(); setMessage("Sessão encerrada neste dispositivo."); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  async function resetPassword() {
    setBusy(true); setError(""); setMessage("");
    try { await resetAccountPassword(email); setMessage("Enviamos um link para redefinir a senha da conta."); }
    catch (e) { setError(String(e).replace(/^Error:\s*/, "")); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
    <section className="w-full max-w-md rounded-2xl border border-vault-border bg-vault-card p-5 shadow-2xl">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-vault-primary/20"><Cloud size={18} className="text-vault-primary" /></span><div><h2 className="font-semibold text-vault-text">Conta e nuvem</h2><p className="text-xs text-vault-textMuted">Backup criptografado e compartilhamentos</p></div></div>
        <button onClick={onClose} className="text-vault-textMuted hover:text-vault-text" aria-label="Fechar"><X size={20} /></button>
      </header>

      {firebaseAccount ? <div className="space-y-4">
        <div className="rounded-xl border border-vault-border bg-vault-sidebar p-3"><p className="text-sm text-vault-text">{firebaseAccount.email}</p><p className="mt-1 text-xs text-vault-textMuted">E-mail confirmado · sessão válida enquanto o app estiver aberto</p></div>
        <div className="flex items-start gap-2 rounded-xl bg-vault-success/10 p-3 text-xs text-vault-success"><ShieldCheck size={15} className="mt-0.5 shrink-0" />A nuvem recebe apenas o cofre cifrado com sua senha mestra.</div>
        {storageMode === "local" && <p className="rounded-xl bg-vault-sidebar p-3 text-xs text-vault-textMuted">Este cofre está no modo Local e não sincroniza nem compartilha. Ao mudar para Nuvem, enviaremos o cofre atual. Se já existir um backup nessa conta, ele não será sobrescrito.</p>}
        <p className="text-xs text-vault-textMuted">{firebaseBackupRevision ? "Backup já vinculado à conta." : "Ainda não há backup pessoal nesta conta."}</p>
        {storageMode === "local" ? <button onClick={switchToCloud} disabled={busy || !vault} className="flex w-full items-center justify-center gap-2 rounded-xl bg-vault-primary py-2.5 font-medium text-vault-bg disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />}Usar este cofre na nuvem</button> : <button onClick={backupNow} disabled={busy || !vault} className="flex w-full items-center justify-center gap-2 rounded-xl bg-vault-primary py-2.5 font-medium text-vault-bg disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />}Enviar backup agora</button>}
        <button onClick={signOut} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl border border-vault-border py-2 text-sm text-vault-textMuted hover:text-vault-danger"><LogOut size={14} />Sair da conta neste dispositivo</button>
      </div> : <div className="space-y-3">
        <div className="flex gap-2 text-xs"><button onClick={() => setMode("signin")} className={`flex-1 rounded-lg py-2 ${mode === "signin" ? "bg-vault-primary/15 text-vault-primary" : "text-vault-textMuted"}`}>Entrar</button><button onClick={() => setMode("create")} className={`flex-1 rounded-lg py-2 ${mode === "create" ? "bg-vault-primary/15 text-vault-primary" : "text-vault-textMuted"}`}>Criar conta</button></div>
        <label className="block text-xs text-vault-textMuted">E-mail<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-vault-border bg-vault-input px-3 py-2.5 text-sm text-vault-text" /></label>
        <label className="block text-xs text-vault-textMuted">Senha da conta<input type="password" autoComplete={mode === "create" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-vault-border bg-vault-input px-3 py-2.5 text-sm text-vault-text" /></label>
        {mode === "signin" && <button type="button" onClick={resetPassword} disabled={busy || !email} className="text-xs text-vault-primary hover:underline"><KeyRound size={12} className="mr-1 inline" />Esqueci a senha</button>}
        {mode === "create" && <label className="block text-xs text-vault-textMuted">Confirme a senha<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-vault-border bg-vault-input px-3 py-2.5 text-sm text-vault-text" /></label>}
        {mode === "create" && <p className="text-xs text-vault-textMuted">Mínimo de 12 caracteres. Será necessário confirmar o e-mail para usar a nuvem.</p>}
        {error && <p role="alert" className="rounded-lg bg-vault-danger/10 p-2.5 text-xs text-vault-danger">{error}</p>}
        {message && <p role="status" className="rounded-lg bg-vault-success/10 p-2.5 text-xs text-vault-success">{message}</p>}
        <button onClick={submit} disabled={busy || !email || !password} className="flex w-full items-center justify-center gap-2 rounded-xl bg-vault-primary py-2.5 font-medium text-vault-bg disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}{mode === "create" ? "Criar conta e enviar confirmação" : "Entrar"}</button>
      </div>}
      <button type="button" onClick={() => void openAccountDeletion()} className="mt-4 flex w-full items-center justify-center gap-2 border-t border-vault-border pt-3 text-xs text-vault-textMuted hover:text-vault-danger">
        <Trash2 size={13} />Solicitar exclusão da conta e dos dados
      </button>
    </section>
  </div>;
}
