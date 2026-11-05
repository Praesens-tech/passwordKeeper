import { X, ShieldCheck, Mail, Github, Lock, HardDrive, Cloud, Share2 } from "lucide-react";
import { version as APP_VERSION } from "../../package.json";

interface AboutScreenProps {
  onClose: () => void;
}

export function AboutScreen({ onClose }: AboutScreenProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-vault-card border border-vault-border rounded-2xl w-full max-w-md mx-4 shadow-2xl animate-slide-up max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-vault-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg border border-vault-border bg-white p-2.5 flex items-center justify-center">
              <img src="/assets/praesens_simbolo.svg" alt="Praesens" className="h-full w-full object-contain" />
            </div>
            <div>
              <h2 className="text-vault-text font-bold text-lg leading-tight">Password Keeper</h2>
              <p className="text-vault-textMuted text-sm">Versão {APP_VERSION}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-vault-textMuted hover:text-vault-text hover:bg-vault-sidebar transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          {/* Description */}
          <p className="text-vault-textSecondary text-sm leading-relaxed">
            Cofre de senhas seguro para guardar, organizar e compartilhar credenciais.
            Suas senhas são sempre criptografadas no seu dispositivo — nenhum dado é enviado sem proteção.
          </p>

          {/* Security info */}
          <div>
            <p className="text-vault-textMuted text-xs font-semibold uppercase tracking-wider mb-2.5">Segurança</p>
            <div className="space-y-2">
              <InfoRow
                icon={<Lock size={15} className="text-vault-primary" />}
                label="Criptografia"
                value="AES-256-GCM — padrão militar, usado por bancos e governos"
              />
              <InfoRow
                icon={<ShieldCheck size={15} className="text-vault-primary" />}
                label="Senha mestra"
                value="Nunca armazenada — derivada com PBKDF2 (310.000 iterações)"
              />
              <InfoRow
                icon={<HardDrive size={15} className="text-vault-primary" />}
                label="Armazenamento local"
                value="Arquivo .keep criptografado no seu computador"
              />
              <InfoRow
                icon={<Cloud size={15} className="text-vault-primary" />}
                label="Nuvem"
                value="Backup e compartilhamento cifrados; requer conta confirmada"
              />
              <InfoRow
                icon={<Share2 size={15} className="text-vault-primary" />}
                label="Compartilhamento"
                value="Cofre cifrado; senha de compartilhamento separada"
              />
            </div>
          </div>

          {/* Developer */}
          <div>
            <p className="text-vault-textMuted text-xs font-semibold uppercase tracking-wider mb-2.5">Desenvolvedor</p>
            <div className="p-4 bg-vault-sidebar border border-vault-border rounded-xl space-y-2.5">
              <p className="text-vault-text font-medium text-sm">Marcelo Lima</p>
              <div className="flex items-center gap-2 text-vault-textSecondary text-sm">
                <Mail size={14} className="text-vault-textMuted flex-shrink-0" />
                <a href="mailto:mpblima@gmail.com" className="hover:text-vault-primary transition-colors truncate">
                  mpblima@gmail.com
                </a>
              </div>
              <div className="flex items-center gap-2 text-vault-textSecondary text-sm">
                <Github size={14} className="text-vault-textMuted flex-shrink-0" />
                <a href="https://github.com/mpblima" className="hover:text-vault-primary transition-colors truncate">
                  github.com/mpblima
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-vault-primary hover:bg-vault-primaryHover rounded-xl text-white font-medium transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 p-3 bg-vault-sidebar border border-vault-border rounded-xl">
      <div className="mt-0.5 flex-shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-vault-text text-xs font-medium">{label}</p>
        <p className="text-vault-textMuted text-xs mt-0.5 leading-relaxed">{value}</p>
      </div>
    </div>
  );
}
