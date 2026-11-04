import { useEffect, useState } from "react";
import { X, Share2, Lock, Check, AlertCircle, Eye, EyeOff, Loader2, RefreshCw, ArrowRight, FileKey } from "lucide-react";
import { useVaultStore } from "../store/vaultStore";
import { decryptVaultEnvelope } from "../services/crypto";
import { VaultData } from "../types/vault";
import { getFirebaseVault, listFirebaseSharesForEmail } from "../services/firebase";

interface ImportSharedFileProps {
  onClose: () => void;
}

export function ImportSharedFile({ onClose }: ImportSharedFileProps) {
  const {
    googleToken, userInfo, ensureValidToken, authenticateFirebase, addSharedSource,
  } = useVaultStore();
  const [files, setFiles] = useState<{ id: string; name: string; owner: string }[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [step, setStep] = useState<"pick" | "password" | "opening" | "done" | "error">("pick");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  async function loadShares() {
    setLoading(true);
    setErrorMsg("");
    try {
      await ensureValidToken();
      const identity = await authenticateFirebase();
      const email = identity.email?.trim().toLowerCase();
      if (!email || (userInfo?.email && email !== userInfo.email.trim().toLowerCase())) {
        throw new Error("A conta Firebase não corresponde à conta Google conectada no app.");
      }
      const result = await listFirebaseSharesForEmail(email);
      setFiles(result.map((document) => ({
        id: document.id,
        name: document.collaboration?.title ?? "Compartilhamento",
        owner: document.ownerEmail ?? "Proprietário",
      })));
      setStep("pick");
    } catch (err) {
      setErrorMsg(googleToken ? String(err) : "Conecte sua conta Google no app primeiro.");
      setStep("error");
    }
    setLoading(false);
  }

  async function handleOpen(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFileId || !password) return;
    setStep("opening");
    try {
      const document = await getFirebaseVault(selectedFileId);
      if (!document) throw new Error("Compartilhamento não encontrado ou acesso revogado.");

      // Usar decryptVaultEnvelope para suportar v2 (envelope multi-slot) e legado
      const opened = await decryptVaultEnvelope(document.ciphertext, password);
      const remoteData = JSON.parse(opened.plaintext) as VaultData;

      // Registrar o documento Firestore como uma fonte colaborativa separada.
      addSharedSource(
        selectedFileId,
        remoteData,
        password,
        String(document.revision),
        { dataKey: opened.dataKey, keySlots: opened.keySlots },
        "firebase",
      );
      setStep("done");
      setTimeout(onClose, 800);
    } catch {
      setErrorMsg("Senha incorreta ou cofre inválido.");
      setStep("error");
    }
  }

  useEffect(() => {
    loadShares().catch(() => {});
  }, []);

  const selectedFile = files.find((file) => file.id === selectedFileId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-vault-card border border-vault-border rounded-2xl w-full max-w-md mx-4 shadow-2xl animate-slide-up">
        <div className="flex items-center justify-between p-6 border-b border-vault-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-vault-accent/20 flex items-center justify-center">
              <Share2 size={18} className="text-vault-accent" />
            </div>
            <div>
              <h2 className="text-vault-text font-semibold">Abrir compartilhamento</h2>
              <p className="text-vault-textMuted text-sm">Acessar compartilhamentos Firebase da sua conta Google</p>
            </div>
          </div>
          <button onClick={onClose} className="text-vault-textMuted hover:text-vault-text transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          {step === "pick" && (
            <div className="space-y-4">
              {userInfo && <p className="text-vault-textMuted text-xs">Conta: {userInfo.email}</p>}
              <button
                onClick={loadShares}
                disabled={loading}
                className="w-full py-2.5 bg-vault-sidebar border border-vault-border rounded-xl text-vault-textSecondary hover:text-vault-text text-sm transition-colors flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                Atualizar compartilhamentos
              </button>

              {loading ? (
                <div className="text-center py-8 text-vault-textMuted text-sm">
                  <Loader2 size={24} className="animate-spin mx-auto mb-3" />
                  Buscando no Firebase...
                </div>
              ) : files.length === 0 ? (
                <div className="p-4 bg-vault-sidebar border border-vault-border rounded-xl text-center">
                  <Share2 size={32} className="text-vault-textMuted mx-auto mb-2" />
                  <p className="text-vault-textSecondary text-sm font-medium">Nenhum cofre encontrado</p>
                  <p className="text-vault-textMuted text-xs mt-1">
                    Os compartilhamentos destinados a este e-mail aparecem aqui após o proprietário criar o acesso.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {files.map((file) => (
                    <button
                      key={file.id}
                      onClick={() => { setSelectedFileId(file.id); setStep("password"); }}
                      className="w-full flex items-center gap-3 p-3 bg-vault-sidebar border border-vault-border hover:border-vault-primary/40 rounded-xl transition-colors text-left"
                    >
                      <FileKey size={16} className="text-vault-primary" />
                      <span className="flex-1 min-w-0 text-vault-textSecondary text-sm truncate">{file.name}</span>
                      <ArrowRight size={14} className="text-vault-textMuted" />
                    </button>
                  ))}
                </div>
              )}

              <button onClick={onClose} className="w-full py-2.5 bg-vault-card border border-vault-border rounded-xl text-vault-textSecondary text-sm">
                Fechar
              </button>
            </div>
          )}

          {step === "password" && (
            <form onSubmit={handleOpen} className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-vault-success/10 border border-vault-success/20 rounded-xl">
                <Check size={15} className="text-vault-success flex-shrink-0" />
                <p className="text-sm text-vault-success truncate">
                  {selectedFile?.name ?? "Cofre compartilhado"}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-vault-textSecondary mb-1.5">
                  <Lock size={13} className="inline mr-1" />
                  Senha mestra ou de compartilhamento
                </label>
                <div className="relative">
                  <input
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Senha mestra ou de compartilhamento"
                    required
                    autoFocus
                    className="w-full bg-vault-input border border-vault-border rounded-xl px-4 py-2.5 pr-11 text-vault-text placeholder-vault-textMuted focus:outline-none focus:border-vault-primary transition-colors"
                  />
                  <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-vault-textMuted hover:text-vault-text transition-colors">
                    {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setStep("pick")} className="flex-1 py-2.5 bg-vault-sidebar border border-vault-border rounded-xl text-vault-textSecondary text-sm">
                  Voltar
                </button>
                <button type="submit" disabled={!password} className="flex-1 py-2.5 bg-vault-primary hover:bg-vault-primaryHover disabled:opacity-40 rounded-xl text-vault-bg font-medium text-sm transition-colors flex items-center justify-center gap-2">
                  <ArrowRight size={15} /> Abrir
                </button>
              </div>
            </form>
          )}

          {step === "opening" && (
            <div className="text-center py-10">
              <div className="w-12 h-12 rounded-full border-2 border-vault-primary border-t-transparent animate-spin mx-auto mb-4" />
              <p className="text-vault-text font-medium">Abrindo cofre compartilhado...</p>
              <p className="text-vault-textMuted text-sm mt-1">As permissões serão aplicadas automaticamente</p>
            </div>
          )}

          {step === "done" && (
            <div className="text-center py-6 space-y-3">
              <Check size={36} className="text-vault-success mx-auto" />
              <p className="text-vault-text font-semibold">Cofre aberto</p>
            </div>
          )}

          {step === "error" && (
            <div className="text-center py-6 space-y-4">
              <AlertCircle size={36} className="text-vault-danger mx-auto" />
              <div>
                <h3 className="text-vault-text font-semibold">Não foi possível abrir</h3>
                <p className="text-vault-textMuted text-sm mt-1">{errorMsg}</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep("pick")} className="flex-1 py-2.5 bg-vault-sidebar border border-vault-border rounded-xl text-vault-textSecondary text-sm">
                  Tentar novamente
                </button>
                <button onClick={onClose} className="flex-1 py-2.5 bg-vault-danger/20 border border-vault-danger/30 rounded-xl text-vault-danger text-sm font-medium">
                  Fechar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
