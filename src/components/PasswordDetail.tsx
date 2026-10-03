import { useState } from "react";
import { Copy, Check, Eye, EyeOff, Edit, Trash2, Star, ExternalLink, Share2, Calendar, Flag, AlertCircle } from "lucide-react";
import { IconDisplay } from "./IconDisplay";
import { Tooltip } from "./Tooltip";
import { useVaultStore } from "../store/vaultStore";
import { PasswordForm } from "./PasswordForm";
import { ShareModal } from "./ShareModal";
import { measurePasswordStrength } from "../services/crypto";
import { copyToClipboard } from "../utils/clipboard";

interface CopyButtonProps {
  text: string;
  label?: string;
}

function CopyButton({ text, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCopy() {
    try {
      await copyToClipboard(text, {
        clearAfterMs: label === "senha" ? 30000 : 60000, // 30s for passwords, 60s for others
        showNotification: false // We handle UI feedback ourselves
      });
      setCopied(true);
      setError(null);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(String(err));
      setTimeout(() => setError(null), 3000);
    }
  }

  return (
    <button
      onClick={handleCopy}
      title={`Copiar ${label ?? ""}`}
      className="p-1.5 rounded-lg text-vault-textMuted hover:text-vault-primary hover:bg-vault-primary/10 transition-all"
    >
      {error ? (
        <span title={error}><AlertCircle size={15} className="text-vault-danger" /></span>
      ) : (
        copied ? <Check size={15} className="text-vault-success" /> : <Copy size={15} />
      )}
    </button>
  );
}

export function PasswordDetail() {
  const { vault, sharedSources, selectedEntryId, selectEntry, deleteEntry, toggleFavorite, requestDeletion, currentUserRole, userInfo } = useVaultStore();
  const [showPassword, setShowPassword] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [requestSent, setRequestSent] = useState(false);

  const sharedSource = sharedSources.find((source) => source.entries.some((e) => e.id === selectedEntryId));
  const entry = vault?.entries.find((e) => e.id === selectedEntryId)
    ?? sharedSource?.entries.find((e) => e.id === selectedEntryId);
  if (!entry) return null;

  const group = sharedSource
    ? sharedSource.groups.find((g) => g.id === entry.groupId)
    : vault?.groups.find((g) => g.id === entry.groupId);
  const strength = measurePasswordStrength(entry.password);
  const role = sharedSource?.role ?? currentUserRole("entry", entry.id);
  const isOwner = role === "owner";
  const canEdit = role === "owner" || role === "editor";

  // Check if there is already a pending deletion request for this entry
  const hasPendingRequest = vault?.deletionRequests?.some((r) => r.entryId === entry.id);

  function handleDelete() {
    if (!entry) return;
    deleteEntry(entry.id);
    selectEntry(null);
    setConfirmDelete(false);
  }

  function handleRequestDeletion() {
    if (!entry) return;
    requestDeletion(entry.id);
    setRequestSent(true);
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit", month: "short", year: "numeric",
    });
  }

  return (
    <>
      <div className="flex flex-col h-full bg-vault-sidebar animate-fade-in">
        {/* Header */}
        <div className="p-5 border-b border-vault-border">
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-2xl bg-vault-card border border-vault-border flex items-center justify-center overflow-hidden flex-shrink-0">
              <IconDisplay icon={entry.icon} size="w-14 h-14" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-vault-text font-semibold text-xl leading-tight">{entry.name}</h3>
              {entry.description && (
                <p className="text-vault-textMuted text-sm mt-0.5">{entry.description}</p>
              )}
              {group && (
                <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full bg-vault-card border border-vault-border text-xs text-vault-textMuted">
                  <IconDisplay icon={group.icon} size="w-4 h-4" /> {group.name}
                </span>
              )}
              {sharedSource && (
                <span className="inline-flex items-center gap-1 mt-1.5 ml-2 px-2 py-0.5 rounded-full bg-vault-primary/15 border border-vault-primary/30 text-xs text-vault-primary">
                  Compartilhado por {sharedSource.owner}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 py-3 border-b border-vault-border flex items-center gap-2">
          {canEdit && (
            <button
              onClick={() => setShowEdit(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-vault-primary/20 hover:bg-vault-primary/30 border border-vault-primary/30 rounded-lg text-vault-primary text-sm font-medium transition-colors"
            >
              <Edit size={14} /> Editar
            </button>
          )}
          {isOwner && (
            <button
              onClick={() => setShowShare(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-vault-card hover:bg-vault-cardHover border border-vault-border rounded-lg text-vault-textSecondary hover:text-vault-text text-sm transition-colors"
            >
              <Share2 size={14} /> Compartilhar
            </button>
          )}
          <Tooltip label={entry.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}>
            <button
              onClick={() => toggleFavorite(entry.id)}
              className={`p-1.5 rounded-lg border transition-colors ${
                entry.favorite
                  ? "bg-vault-warning/20 border-vault-warning/30 text-vault-warning"
                  : "bg-vault-card border-vault-border text-vault-textMuted hover:text-vault-warning"
              }`}
            >
              <Star size={16} fill={entry.favorite ? "currentColor" : "none"} />
            </button>
          </Tooltip>

          {/* Delete: owner can delete directly; editors can only request deletion of their own entries */}
          <div className="ml-auto">
            {isOwner ? (
              <Tooltip label="Excluir senha">
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="p-1.5 rounded-lg bg-vault-card border border-vault-border text-vault-textMuted hover:text-vault-danger hover:border-vault-danger/30 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </Tooltip>
            ) : (role === "editor" && entry.createdBy === userInfo?.email) ? (
              hasPendingRequest || requestSent ? (
                <span className="flex items-center gap-1.5 px-3 py-1.5 bg-vault-warning/10 border border-vault-warning/30 rounded-lg text-vault-warning text-xs">
                  <Flag size={13} /> Solicitado
                </span>
              ) : (
                <button
                  onClick={handleRequestDeletion}
                  title="Solicitar exclusão ao proprietário"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-vault-card border border-vault-border rounded-lg text-vault-textMuted hover:text-vault-warning hover:border-vault-warning/30 text-sm transition-colors"
                >
                  <Flag size={14} /> Solicitar exclusão
                </button>
              )
            ) : null}
          </div>
        </div>

        {/* Fields */}
        <div className="flex-1 overflow-y-auto p-5">
        <div className="max-w-xl space-y-4">
          {/* Username */}
          <div className="bg-vault-card border border-vault-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-vault-textMuted uppercase tracking-wide">
                Usuário / Email
              </label>
              <CopyButton text={entry.username} label="usuário" />
            </div>
            <p className="text-vault-text font-medium break-all">{entry.username}</p>
          </div>

          {/* Password */}
          <div className="bg-vault-card border border-vault-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-vault-textMuted uppercase tracking-wide">
                Senha
              </label>
              <div className="flex gap-1">
                <button
                  onClick={() => setShowPassword(!showPassword)}
                  className="p-1.5 rounded-lg text-vault-textMuted hover:text-vault-text transition-colors"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                <CopyButton text={entry.password} label="senha" />
              </div>
            </div>
            <p className="text-vault-text font-mono font-medium break-all">
              {showPassword ? entry.password : "•".repeat(Math.min(entry.password.length, 24))}
            </p>
            {/* Strength */}
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-vault-textMuted">Força</span>
                <span className="text-xs font-medium" style={{ color: strength.color }}>{strength.label}</span>
              </div>
              <div className="h-1 bg-vault-border rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${strength.score}%`, backgroundColor: strength.color }}
                />
              </div>
            </div>
          </div>

          {/* URL */}
          {entry.url && (
            <div className="bg-vault-card border border-vault-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-vault-textMuted uppercase tracking-wide">
                  Site / URL
                </label>
                <div className="flex gap-1">
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg text-vault-textMuted hover:text-vault-accent transition-colors"
                  >
                    <ExternalLink size={15} />
                  </a>
                  <CopyButton text={entry.url} label="URL" />
                </div>
              </div>
              <p className="text-vault-accent text-sm break-all">{entry.url}</p>
            </div>
          )}

          {/* Notes */}
          {entry.notes && (
            <div className="bg-vault-card border border-vault-border rounded-xl p-4">
              <label className="text-xs font-medium text-vault-textMuted uppercase tracking-wide block mb-2">
                Notas
              </label>
              <p className="text-vault-textSecondary text-sm whitespace-pre-wrap">{entry.notes}</p>
            </div>
          )}

          {/* Metadata */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center gap-1.5 text-xs text-vault-textMuted">
              <Calendar size={12} />
              Criado: {formatDate(entry.createdAt)}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-vault-textMuted">
              <Calendar size={12} />
              Atualizado: {formatDate(entry.updatedAt)}
            </div>
            {entry.createdBy && entry.createdBy !== vault?.owner && (
              <div className="flex items-center gap-1.5 text-xs text-vault-textMuted">
                <Edit size={12} />
                Adicionado por: {entry.createdBy}
              </div>
            )}
          </div>
        </div>
        </div>

        {/* Delete confirm */}
        {confirmDelete && (
          <div className="p-4 border-t border-vault-border bg-vault-danger/5">
            <p className="text-sm text-vault-danger font-medium mb-3">
              Excluir "{entry.name}"? Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-2 bg-vault-card border border-vault-border rounded-xl text-vault-textMuted text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-2 bg-vault-danger/20 border border-vault-danger/40 rounded-xl text-vault-danger text-sm font-medium"
              >
                Excluir
              </button>
            </div>
          </div>
        )}
      </div>

      {showEdit && <PasswordForm entry={entry} onClose={() => setShowEdit(false)} />}
      {showShare && (
        <ShareModal target={entry} type="entry" onClose={() => setShowShare(false)} />
      )}
    </>
  );
}
