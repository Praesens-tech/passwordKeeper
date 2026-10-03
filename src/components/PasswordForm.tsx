import { useState, useEffect } from "react";
import { Eye, EyeOff, RefreshCw, X, ChevronDown } from "lucide-react";
import { useVaultStore } from "../store/vaultStore";
import { PasswordEntry } from "../types/vault";
import { generatePassword, measurePasswordStrength } from "../services/crypto";
import { IconPicker } from "./IconPicker";
import { IconDisplay } from "./IconDisplay";
import { isImageIcon } from "../services/imageUtils";

interface PasswordFormProps {
  entry?: PasswordEntry;
  defaultGroupId?: string;
  onClose: () => void;
}

export function PasswordForm({ entry, defaultGroupId, onClose }: PasswordFormProps) {
  const { vault, sharedSources, addEntry, updateEntry } = useVaultStore();
  const entrySource = entry?.sharedSourceId
    ? sharedSources.find((source) => source.id === entry.sharedSourceId)
    : null;
  const [showPassword, setShowPassword] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [genLength, setGenLength] = useState(20);
  const [genOptions, setGenOptions] = useState({
    upper: true, lower: true, numbers: true, symbols: true,
  });

  const [form, setForm] = useState({
    icon: entry?.icon ?? "🔑",
    name: entry?.name ?? "",
    description: entry?.description ?? "",
    username: entry?.username ?? "",
    password: entry?.password ?? "",
    url: entry?.url ?? "",
    notes: entry?.notes ?? "",
    groupId: entry?.groupId ?? defaultGroupId ?? "",
    favorite: entry?.favorite ?? false,
  });

  const strength = measurePasswordStrength(form.password);

  function handleField(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleGenerate() {
    const pwd = generatePassword(genLength, genOptions);
    handleField("password", pwd);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.password.trim()) return;
    if (entry) {
      updateEntry(entry.id, form);
    } else {
      addEntry(form);
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-vault-card border border-vault-border rounded-2xl w-full max-w-lg mx-4 shadow-2xl animate-slide-up max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-vault-border">
          <div className="flex items-center gap-3">
            {/* Icon Button */}
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
                  <IconPicker value={form.icon} onChange={(icon) => { handleField("icon", icon); setShowIconPicker(false); }} />
                </div>
              )}
            </div>
            <div>
              <h2 className="text-vault-text font-semibold text-lg">
                {entry ? "Editar Senha" : "Nova Senha"}
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
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-vault-textSecondary mb-1.5">
              Nome <span className="text-vault-danger">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleField("name", e.target.value)}
              placeholder="Ex: Gmail pessoal"
              required
              className="w-full bg-vault-input border border-vault-border rounded-xl px-4 py-2.5 text-vault-text placeholder-vault-textMuted focus:outline-none focus:border-vault-primary transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-vault-textSecondary mb-1.5">Descrição</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => handleField("description", e.target.value)}
              placeholder="Descrição opcional"
              className="w-full bg-vault-input border border-vault-border rounded-xl px-4 py-2.5 text-vault-text placeholder-vault-textMuted focus:outline-none focus:border-vault-primary transition-colors"
            />
          </div>

          {/* Username */}
          <div>
            <label className="block text-sm font-medium text-vault-textSecondary mb-1.5">
              Usuário / Email <span className="text-vault-danger">*</span>
            </label>
            <input
              type="text"
              value={form.username}
              onChange={(e) => handleField("username", e.target.value)}
              placeholder="usuario@exemplo.com"
              required
              className="w-full bg-vault-input border border-vault-border rounded-xl px-4 py-2.5 text-vault-text placeholder-vault-textMuted focus:outline-none focus:border-vault-primary transition-colors"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-vault-textSecondary mb-1.5">
              Senha <span className="text-vault-danger">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={(e) => handleField("password", e.target.value)}
                placeholder="Senha"
                required
                className="w-full bg-vault-input border border-vault-border rounded-xl px-4 py-2.5 pr-20 text-vault-text font-mono placeholder-vault-textMuted focus:outline-none focus:border-vault-primary transition-colors"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                <button
                  type="button"
                  onClick={() => setShowGenerator(!showGenerator)}
                  title="Gerar senha"
                  className="p-1.5 text-vault-textMuted hover:text-vault-primary transition-colors"
                >
                  <RefreshCw size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="p-1.5 text-vault-textMuted hover:text-vault-text transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Strength bar */}
            {form.password && (
              <div className="mt-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-vault-textMuted">Força da senha</span>
                  <span className="text-xs font-medium" style={{ color: strength.color }}>{strength.label}</span>
                </div>
                <div className="h-1.5 bg-vault-border rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${strength.score}%`, backgroundColor: strength.color }}
                  />
                </div>
              </div>
            )}

            {/* Password generator */}
            {showGenerator && (
              <div className="mt-3 p-4 bg-vault-sidebar rounded-xl border border-vault-border space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-vault-text">Gerador de senha</span>
                  <span className="text-vault-primary font-mono text-sm">{genLength} chars</span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={64}
                  value={genLength}
                  onChange={(e) => setGenLength(Number(e.target.value))}
                  className="w-full accent-vault-primary"
                />
                <div className="flex flex-wrap gap-2">
                  {(["upper", "lower", "numbers", "symbols"] as const).map((opt) => (
                    <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={genOptions[opt]}
                        onChange={(e) => setGenOptions((o) => ({ ...o, [opt]: e.target.checked }))}
                        className="accent-vault-primary w-3.5 h-3.5"
                      />
                      <span className="text-xs text-vault-textSecondary">
                        {opt === "upper" ? "A-Z" : opt === "lower" ? "a-z" : opt === "numbers" ? "0-9" : "!@#"}
                      </span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleGenerate}
                  className="w-full py-2 bg-vault-primary/20 hover:bg-vault-primary/30 border border-vault-primary/40 rounded-lg text-vault-primary text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <RefreshCw size={14} /> Gerar senha
                </button>
              </div>
            )}
          </div>

          {/* URL */}
          <div>
            <label className="block text-sm font-medium text-vault-textSecondary mb-1.5">URL / Site</label>
            <input
              type="url"
              value={form.url}
              onChange={(e) => handleField("url", e.target.value)}
              placeholder="https://exemplo.com"
              className="w-full bg-vault-input border border-vault-border rounded-xl px-4 py-2.5 text-vault-text placeholder-vault-textMuted focus:outline-none focus:border-vault-primary transition-colors"
            />
          </div>

          {/* Group */}
          <div>
            <label className="block text-sm font-medium text-vault-textSecondary mb-1.5">Grupo</label>
            <div className="relative">
              <select
                value={form.groupId}
                onChange={(e) => handleField("groupId", e.target.value)}
                className="w-full bg-vault-input border border-vault-border rounded-xl px-4 py-2.5 text-vault-text focus:outline-none focus:border-vault-primary transition-colors appearance-none"
              >
                <option value="">Sem grupo</option>
                {vault?.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {isImageIcon(g.icon) ? "" : g.icon} {g.name}
                  </option>
                ))}
                {entrySource?.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {isImageIcon(g.icon) ? "" : g.icon} {g.name}
                  </option>
                ))}
                {!entrySource && sharedSources.flatMap((source) =>
                  source.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {isImageIcon(g.icon) ? "" : g.icon} {source.owner} / {g.name}
                    </option>
                  ))
                )}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-vault-textMuted pointer-events-none" />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-vault-textSecondary mb-1.5">Notas</label>
            <textarea
              value={form.notes}
              onChange={(e) => handleField("notes", e.target.value)}
              placeholder="Anotações adicionais..."
              rows={3}
              className="w-full bg-vault-input border border-vault-border rounded-xl px-4 py-2.5 text-vault-text placeholder-vault-textMuted focus:outline-none focus:border-vault-primary transition-colors resize-none"
            />
          </div>

          {/* Favorite */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.favorite}
              onChange={(e) => handleField("favorite", e.target.checked)}
              className="accent-vault-warning w-4 h-4"
            />
            <span className="text-sm text-vault-textSecondary">Marcar como favorito ⭐</span>
          </label>

          {/* Actions */}
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
              {entry ? "Salvar" : "Adicionar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
