import { useState } from "react";
import { X } from "lucide-react";
import { useVaultStore } from "../store/vaultStore";
import { PasswordGroup } from "../types/vault";
import { IconPicker } from "./IconPicker";
import { IconDisplay } from "./IconDisplay";

interface GroupFormProps {
  group?: PasswordGroup;
  onClose: () => void;
}

export function GroupForm({ group, onClose }: GroupFormProps) {
  const { addGroup, updateGroup } = useVaultStore();
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [form, setForm] = useState({
    icon: group?.icon ?? "📁",
    name: group?.name ?? "",
    description: group?.description ?? "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (group) {
      updateGroup(group.id, form);
    } else {
      addGroup(form);
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-vault-card border border-vault-border rounded-2xl w-full max-w-md mx-4 shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-vault-border">
          <div className="flex items-center gap-3">
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowIconPicker(!showIconPicker)}
                className="w-12 h-12 rounded-xl bg-vault-sidebar border border-vault-border text-2xl flex items-center justify-center hover:border-vault-primary transition-colors"
              >
                <IconDisplay icon={form.icon} size="w-10 h-10" />
              </button>
              {showIconPicker && (
                <div className="absolute top-14 left-0 z-10">
                  <IconPicker
                    value={form.icon}
                    onChange={(icon) => {
                      setForm((f) => ({ ...f, icon }));
                      setShowIconPicker(false);
                    }}
                  />
                </div>
              )}
            </div>
            <div>
              <h2 className="text-vault-text font-semibold text-lg">
                {group ? "Editar Grupo" : "Novo Grupo"}
              </h2>
              <p className="text-vault-textMuted text-sm">Clique no ícone para personalizar</p>
            </div>
          </div>
          <button onClick={onClose} className="text-vault-textMuted hover:text-vault-text transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-vault-textSecondary mb-1.5">
              Nome <span className="text-vault-danger">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ex: Redes Sociais"
              required
              autoFocus
              className="w-full bg-vault-input border border-vault-border rounded-xl px-4 py-2.5 text-vault-text placeholder-vault-textMuted focus:outline-none focus:border-vault-primary transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-vault-textSecondary mb-1.5">Descrição</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Descrição opcional"
              className="w-full bg-vault-input border border-vault-border rounded-xl px-4 py-2.5 text-vault-text placeholder-vault-textMuted focus:outline-none focus:border-vault-primary transition-colors"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-vault-sidebar border border-vault-border rounded-xl text-vault-textSecondary hover:text-vault-text transition-colors font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 bg-vault-primary hover:bg-vault-primaryHover rounded-xl text-white font-medium transition-colors"
            >
              {group ? "Salvar" : "Criar Grupo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
