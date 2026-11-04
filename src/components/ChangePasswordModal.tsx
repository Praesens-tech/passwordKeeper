import { useState } from "react";
import { X, Key, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useVaultStore } from "../store/vaultStore";
import { measurePasswordStrength } from "../services/crypto";

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { changePassword, saveToLocalFile, syncToCloud, syncToFirebase, firebaseVaultId, localVaultPath, googleToken } = useVaultStore();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const strength = measurePasswordStrength(newPassword);
  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;
  const passwordMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (passwordMismatch) { setError("As senhas não coincidem"); return; }
    if (newPassword.length < 8) { setError("A nova senha deve ter pelo menos 8 caracteres"); return; }

    setLoading(true);
    setError("");
    try {
      await changePassword(currentPassword, newPassword);
      if (localVaultPath) await saveToLocalFile(localVaultPath);
      if (googleToken) await syncToCloud();
      if (firebaseVaultId) await syncToFirebase();
      setSuccess(true);
      setTimeout(onClose, 2000);
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-vault-card border border-vault-border rounded-2xl p-6 w-full max-w-md shadow-2xl mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-vault-primary/20 flex items-center justify-center">
              <Key size={18} className="text-vault-primary" />
            </div>
            <h2 className="text-vault-text font-semibold text-lg">Trocar Senha do Cofre</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-vault-textMuted hover:text-vault-text hover:bg-vault-sidebar transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {success ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-full bg-vault-success/20 flex items-center justify-center mx-auto mb-4">
              <ShieldCheck size={28} className="text-vault-success" />
            </div>
            <p className="text-vault-text font-semibold text-base">Senha alterada com sucesso!</p>
            <p className="text-vault-textMuted text-sm mt-1">O cofre foi salvo com a nova senha.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Current password */}
            <div>
              <label className="block text-xs font-medium text-vault-textSecondary mb-1.5">
                Senha atual
              </label>
              <div className="relative">
                <input
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full bg-vault-sidebar border border-vault-border rounded-xl px-4 py-2.5 pr-10 text-sm text-vault-text placeholder-vault-textMuted focus:outline-none focus:border-vault-primary transition-colors"
                  placeholder="Digite a senha atual"
                  required
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-vault-textMuted hover:text-vault-text transition-colors"
                >
                  {showCurrent ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* New password */}
            <div>
              <label className="block text-xs font-medium text-vault-textSecondary mb-1.5">
                Nova senha
              </label>
              <div className="relative">
                <input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-vault-sidebar border border-vault-border rounded-xl px-4 py-2.5 pr-10 text-sm text-vault-text placeholder-vault-textMuted focus:outline-none focus:border-vault-primary transition-colors"
                  placeholder="Digite a nova senha"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-vault-textMuted hover:text-vault-text transition-colors"
                >
                  {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {newPassword && (
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-vault-textMuted">Força da senha</span>
                    <span className="text-xs font-medium" style={{ color: strength.color }}>
                      {strength.label}
                    </span>
                  </div>
                  <div className="h-1 bg-vault-sidebar rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${strength.score}%`, backgroundColor: strength.color }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div>
              <label className="block text-xs font-medium text-vault-textSecondary mb-1.5">
                Confirmar nova senha
              </label>
              <div className="relative">
                <input
                  type={showConfirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`w-full bg-vault-sidebar border rounded-xl px-4 py-2.5 pr-10 text-sm text-vault-text placeholder-vault-textMuted focus:outline-none transition-colors ${
                    passwordMismatch
                      ? "border-vault-danger focus:border-vault-danger"
                      : "border-vault-border focus:border-vault-primary"
                  }`}
                  placeholder="Confirme a nova senha"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-vault-textMuted hover:text-vault-text transition-colors"
                >
                  {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {passwordMismatch && (
                <p className="text-vault-danger text-xs mt-1">As senhas não coincidem</p>
              )}
            </div>

            {error && (
              <div className="bg-vault-danger/10 border border-vault-danger/30 rounded-xl px-4 py-2.5 text-vault-danger text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 bg-vault-sidebar border border-vault-border rounded-xl text-vault-textMuted text-sm hover:text-vault-text transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading || !passwordsMatch || !currentPassword}
                className="flex-1 py-2.5 bg-vault-primary hover:bg-vault-primaryHover rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Salvando..." : "Alterar Senha"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
