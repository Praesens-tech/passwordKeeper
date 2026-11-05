import { useState } from "react";
import { X, Share2, Mail, Copy, Check, AlertCircle, Lock, ShieldCheck, Eye, Edit } from "lucide-react";
import { useVaultStore } from "../store/vaultStore";
import { PasswordEntry, PasswordGroup, VaultPermission } from "../types/vault";
import { copyToClipboard } from "../utils/clipboard";

interface ShareModalProps {
  target: PasswordEntry | PasswordGroup | null;
  type: "entry" | "group" | "vault";
  onClose: () => void;
}

const ROLE_OPTIONS: { value: VaultPermission; label: string; desc: string; icon: React.ReactNode }[] = [
  {
    value: "reader",
    label: "Somente leitura",
    desc: "Pode visualizar as senhas autorizadas, mas não editar nem criar.",
    icon: <Eye size={15} />,
  },
  {
    value: "editor",
    label: "Editor",
    desc: "Pode visualizar, editar e criar dentro do escopo autorizado.",
    icon: <Edit size={15} />,
  },
  {
    value: "owner",
    label: "Proprietário",
    desc: "Acesso total ao escopo autorizado, incluindo exclusões.",
    icon: <ShieldCheck size={15} />,
  },
];

export function ShareModal({ target, type, onClose }: ShareModalProps) {
  const { vault, firebaseAccount, createSharedDocument } = useVaultStore();
  const [step, setStep] = useState<"form" | "sharing" | "done" | "error">("form");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<VaultPermission>("reader");
  const [sharePassword, setSharePassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [copiedPwd, setCopiedPwd] = useState(false);
  const [shareCode, setShareCode] = useState("");

  if (!vault) return null;

  const isVault = type === "vault";
  const isGroup = type === "group";
  const title = isVault ? "Cofre completo" : target?.name ?? "Compartilhamento";

  async function handleShare() {
    if (!email.trim() || !sharePassword) return;
    setStep("sharing");
    try {
      const code = await createSharedDocument({
        targetType: type,
        targetId: target?.id ?? null,
        targetTitle: title,
        collaboratorEmail: email.trim(),
        collaboratorRole: role,
        sharePassword,
      });
      setShareCode(code);
      setStep("done");
    } catch (err) {
      setErrorMsg(String(err));
      setStep("error");
    }
  }

  function generateSharePassword() {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    const arr = new Uint8Array(18);
    crypto.getRandomValues(arr);
    setSharePassword(Array.from(arr, (x) => chars[x % chars.length]).join(""));
  }

  async function copyPassword() {
    await copyToClipboard(sharePassword, { clearAfterMs: 30000, showNotification: false });
    setCopiedPwd(true);
    setTimeout(() => setCopiedPwd(false), 2000);
  }

  const selectedRoleOption = ROLE_OPTIONS.find((r) => r.value === role)!;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-vault-card border border-vault-border rounded-2xl w-full max-w-md mx-4 shadow-2xl animate-slide-up">
        <div className="flex items-center justify-between p-6 border-b border-vault-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-vault-primary/20 flex items-center justify-center">
              <Share2 size={18} className="text-vault-primary" />
            </div>
            <div>
              <h2 className="text-vault-text font-semibold">Compartilhar</h2>
              <p className="text-vault-textMuted text-sm">
                {isVault ? "Cofre" : isGroup ? "Grupo" : "Senha"}: {title}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-vault-textMuted hover:text-vault-text transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          {step === "form" && (
            <div className="space-y-4">
              {!firebaseAccount && (
                <div className="p-3 bg-vault-warning/10 border border-vault-warning/30 rounded-xl flex items-start gap-2">
                  <AlertCircle size={16} className="text-vault-warning mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-vault-warning">
                    Entre na sua conta Password Keeper para compartilhar pela nuvem.
                  </p>
                </div>
              )}

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-vault-textSecondary mb-1.5">
                  <Mail size={13} className="inline mr-1" />
                  Email do destinatário
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="destinatario@gmail.com"
                  className="w-full bg-vault-input border border-vault-border rounded-xl px-4 py-2.5 text-vault-text placeholder-vault-textMuted focus:outline-none focus:border-vault-primary transition-colors"
                />
              </div>

              {/* Role */}
              <div>
                <label className="block text-sm font-medium text-vault-textSecondary mb-2">
                  Nível de acesso
                </label>
                <div className="space-y-2">
                  {ROLE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRole(opt.value)}
                      className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                        role === opt.value
                          ? "border-vault-primary bg-vault-primary/10"
                          : "border-vault-border bg-vault-input hover:border-vault-primary/40"
                      }`}
                    >
                      <span className={`mt-0.5 flex-shrink-0 ${role === opt.value ? "text-vault-primary" : "text-vault-textMuted"}`}>
                        {opt.icon}
                      </span>
                      <div>
                        <p className={`text-sm font-medium ${role === opt.value ? "text-vault-primary" : "text-vault-text"}`}>
                          {opt.label}
                        </p>
                        <p className="text-xs text-vault-textMuted mt-0.5">{opt.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Share password */}
              <div>
                <label className="block text-sm font-medium text-vault-textSecondary mb-1.5">
                  <Lock size={13} className="inline mr-1" />
                  Senha de compartilhamento
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={sharePassword}
                    onChange={(e) => setSharePassword(e.target.value)}
                    placeholder="Senha para abrir este cofre"
                    className="w-full bg-vault-input border border-vault-border rounded-xl px-4 py-2.5 pr-20 text-vault-text font-mono text-sm placeholder-vault-textMuted focus:outline-none focus:border-vault-primary transition-colors"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                    <button
                      type="button"
                      onClick={generateSharePassword}
                      className="px-2 py-1 text-xs bg-vault-primary/20 text-vault-primary rounded-lg hover:bg-vault-primary/30 transition-colors"
                    >
                      Gerar
                    </button>
                    {sharePassword && (
                      <button type="button" onClick={copyPassword} title="Copiar senha" className="p-1.5 text-vault-textMuted hover:text-vault-text transition-colors">
                        {copiedPwd ? <Check size={14} className="text-vault-success" /> : <Copy size={14} />}
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-vault-textMuted mt-1">
                  Envie esta senha ao destinatário por outro canal. Nunca envie sua senha mestra.
                </p>
              </div>

              {/* Info box */}
              <div className="p-3 bg-vault-sidebar border border-vault-border rounded-xl text-xs text-vault-textMuted leading-relaxed">
                Uma cópia criptografada será criada na nuvem. O destinatário encontra o compartilhamento ao entrar com esta conta de e-mail e precisa da senha de compartilhamento para abrir. Seu cofre principal não é alterado.
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={onClose} className="flex-1 py-2.5 bg-vault-sidebar border border-vault-border rounded-xl text-vault-textSecondary hover:text-vault-text transition-colors font-medium">
                  Cancelar
                </button>
                <button
                  onClick={handleShare}
                  disabled={!email || !sharePassword || !firebaseAccount}
                  className="flex-1 py-2.5 bg-vault-primary hover:bg-vault-primaryHover disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <Share2 size={16} /> Compartilhar
                </button>
              </div>
            </div>
          )}

          {step === "sharing" && (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-full border-2 border-vault-primary border-t-transparent animate-spin mx-auto mb-4" />
              <p className="text-vault-text font-medium">Criando compartilhamento...</p>
              <p className="text-vault-textMuted text-sm mt-1">Criptografando e salvando na nuvem</p>
            </div>
          )}

          {step === "done" && (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 rounded-full bg-vault-success/20 flex items-center justify-center mx-auto">
                <Check size={32} className="text-vault-success" />
              </div>
              <div>
                <h3 className="text-vault-text font-semibold text-lg">Compartilhado!</h3>
                <p className="text-vault-textMuted text-sm mt-1">
                  <strong className="text-vault-text">{email}</strong> recebeu acesso como{" "}
                  <strong className="text-vault-primary">{selectedRoleOption.label}</strong>.
                </p>
              </div>
              <div className="p-3 bg-vault-sidebar border border-vault-border rounded-xl text-left">
                <p className="text-sm text-vault-textSecondary font-medium mb-1">Código do compartilhamento</p>
                <div className="flex items-center gap-2">
                  <code className="text-vault-textMuted font-mono text-xs break-all flex-1">{shareCode}</code>
                  <button
                    onClick={() => copyToClipboard(shareCode, { clearAfterMs: 30000, showNotification: false })}
                    className="p-2 text-vault-textMuted hover:text-vault-text"
                    title="Copiar código"
                  ><Copy size={15} /></button>
                </div>
                <p className="text-xs text-vault-textMuted mt-2">A pessoa verá o item em “Compartilhados” ao conectar este e-mail no app.</p>
              </div>
              <div className="p-3 bg-vault-warning/10 border border-vault-warning/30 rounded-xl text-left">
                <p className="text-sm text-vault-warning font-medium mb-1">Senha de compartilhamento:</p>
                <div className="flex items-center gap-2">
                  <code className="text-vault-primary font-mono text-sm bg-vault-input px-3 py-1.5 rounded-lg flex-1 break-all">
                    {sharePassword}
                  </code>
                  <button onClick={copyPassword} className="p-2 text-vault-textMuted hover:text-vault-text transition-colors flex-shrink-0">
                    {copiedPwd ? <Check size={16} className="text-vault-success" /> : <Copy size={16} />}
                  </button>
                </div>
                <p className="text-xs text-vault-textMuted mt-2">
                  Envie esta senha ao destinatário por um canal seguro (ex: mensagem direta).
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-full py-2.5 bg-vault-primary hover:bg-vault-primaryHover rounded-xl text-white font-medium transition-colors"
              >
                Fechar
              </button>
            </div>
          )}

          {step === "error" && (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 rounded-full bg-vault-danger/20 flex items-center justify-center mx-auto">
                <AlertCircle size={32} className="text-vault-danger" />
              </div>
              <div>
                <h3 className="text-vault-text font-semibold">Erro ao compartilhar</h3>
                <p className="text-vault-textMuted text-sm mt-1">{errorMsg}</p>
              </div>
              <button
                onClick={() => setStep("form")}
                className="w-full py-2.5 bg-vault-sidebar border border-vault-border rounded-xl text-vault-textSecondary hover:text-vault-text transition-colors"
              >
                Tentar novamente
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
