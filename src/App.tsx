import { useState, useEffect, useRef } from "react";
import { useVaultStore } from "./store/vaultStore";
import { MasterPasswordScreen } from "./components/MasterPasswordScreen";
import { Sidebar } from "./components/Sidebar";
import { PasswordGrid } from "./components/PasswordGrid";
import { PasswordForm } from "./components/PasswordForm";
import { AppMenuBar } from "./components/AppMenuBar";
import { Cloud, RefreshCw, AlertCircle, X } from "lucide-react";
import { usePlatform } from "./hooks/usePlatform";
import { checkForAppUpdate } from "./services/autoUpdate";
import { watchFirebaseVault, watchPersonalFirebaseVault } from "./services/firebase";

export function App() {
  const { isAndroid } = usePlatform();
  const {
    isLocked, isDirty, isSyncing, syncError, vault, masterPassword, userInfo,
    localVaultPath,
    sharedSources,
    firebaseAuthenticated, firebaseAccount,
    saveToLocalFile, initFromStorage,
    restoreOwnedFirebaseShares,
    forceSync, clearSyncError, lockVault,
  } = useVaultStore();

  const [showAddEntry, setShowAddEntry] = useState(false);
  const [addEntryGroupId, setAddEntryGroupId] = useState<string | undefined>();
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firebaseRestoreStartedRef = useRef<string | null>(null);
  const updateCheckedRef = useRef(false);
  const [sharedNotice, setSharedNotice] = useState("");
  const [isForceSyncing, setIsForceSyncing] = useState(false);

  // ── Inicialização ──────────────────────────────────────────────────────────
  useEffect(() => {
    initFromStorage().catch(() => {});
  }, []);

  // Verifica novas versões em builds instalados. No dev server, evita prompts
  // vindos da última release publicada enquanto estamos desenvolvendo.
  useEffect(() => {
    if (import.meta.env.DEV || updateCheckedRef.current) return;
    updateCheckedRef.current = true;
    const timer = setTimeout(() => {
      checkForAppUpdate("startup").catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isLocked) {
      firebaseRestoreStartedRef.current = null;
      return;
    }
    if (!firebaseAccount) {
      firebaseRestoreStartedRef.current = null;
      return;
    }
    const account = firebaseAccount.email.trim().toLowerCase();
    if (!masterPassword || !vault || firebaseRestoreStartedRef.current === account) return;
    firebaseRestoreStartedRef.current = account;
    restoreOwnedFirebaseShares().catch((error) => {
      if (firebaseRestoreStartedRef.current === account) firebaseRestoreStartedRef.current = null;
      useVaultStore.setState({ syncError: String(error) });
    });
  }, [isLocked, firebaseAccount, masterPassword, vault, restoreOwnedFirebaseShares]);

  useEffect(() => {
    if (isLocked || !firebaseAccount) return;
    return watchPersonalFirebaseVault(firebaseAccount.uid, (snapshot) => {
      useVaultStore.getState().applyFirebaseBackupSnapshot(snapshot).catch((error) => {
        useVaultStore.setState({ syncError: String(error) });
      });
    }, (error) => useVaultStore.setState({ syncError: String(error) }));
  }, [isLocked, firebaseAccount]);

  useEffect(() => {
    if (isLocked || !firebaseAuthenticated) return;
    const stops = sharedSources
      .filter((source) => source.backend === "firebase")
      .map((source) => watchFirebaseVault(
        source.fileId,
        (document) => useVaultStore.getState().refreshFirebaseSharedSource(source.id, document).catch((error) => {
          useVaultStore.setState({ syncError: String(error) });
        }),
        (error) => {
          if ((error as Error & { code?: string }).code === "permission-denied") {
            useVaultStore.getState().removeSharedSource(source.id).catch(() => {});
          } else {
            useVaultStore.setState({ syncError: String(error) });
          }
        },
      ));
    return () => stops.forEach((stop) => stop());
  }, [isLocked, firebaseAuthenticated, sharedSources]);

  // ── Auto-save ──────────────────────────────────────────────────────────────
  // Salva localmente e sincroniza uma cópia cifrada na nuvem quando há uma conta conectada.
  useEffect(() => {
    if (!isDirty) return;
    if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
    autoSyncTimerRef.current = setTimeout(() => {
      const state = useVaultStore.getState();
      const isOwnerOfCollabVault =
        !!state.vault?.collaboration && state.currentUserRole() === "owner";
      if (localVaultPath || isAndroid) {
        saveToLocalFile(localVaultPath ?? undefined).catch(() => {});
      }
      if (firebaseAccount && !isOwnerOfCollabVault) {
        state.syncToFirebase().catch(() => {});
      }
    }, 5000);
    return () => {
      if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
    };
  }, [isDirty, firebaseAccount, localVaultPath, isAndroid]);

  // ── Auto-lock por inatividade (5 min) ────────────────────────────────────
  useEffect(() => {
    if (isLocked) return;

    const resetTimer = () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = setTimeout(() => lockVault(), 5 * 60 * 1000);
    };

    const EVENTS = ["mousedown", "mousemove", "keypress", "scroll", "touchstart"] as const;
    EVENTS.forEach((ev) => window.addEventListener(ev, resetTimer));
    resetTimer();

    return () => {
      EVENTS.forEach((ev) => window.removeEventListener(ev, resetTimer));
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    };
  }, [isLocked, lockVault]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  async function handleForceSync() {
    setIsForceSyncing(true);
    try {
      await forceSync();
    } finally {
      setIsForceSyncing(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (isLocked) {
    return <MasterPasswordScreen />;
  }

  const isCollabVault = !!vault?.collaboration;

  return (
    <div className="h-screen flex flex-col bg-vault-bg overflow-hidden">
      {/* Menu bar */}
      <AppMenuBar onForceSync={handleForceSync} isForceSyncing={isForceSyncing} />

      {/* Sync error banner */}
      {syncError && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs bg-vault-danger/10 text-vault-danger border-b border-vault-danger/20">
          <AlertCircle size={13} className="flex-shrink-0" />
          <span className="flex-1 truncate">Erro de sincronização: {syncError}</span>
          <button
            onClick={clearSyncError}
            className="p-0.5 rounded hover:bg-vault-danger/20 transition-colors flex-shrink-0"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Pending sync / syncing banner */}
      {(isDirty || isSyncing || isForceSyncing) && (
        <button
          onClick={handleForceSync}
          disabled={isSyncing || isForceSyncing}
          className={`w-full flex items-center justify-center gap-2 py-1.5 text-xs transition-all ${
            isSyncing || isForceSyncing
              ? "bg-blue-500/10 text-blue-400 cursor-default"
              : isCollabVault
              ? "bg-vault-warning/10 text-vault-warning hover:bg-vault-warning/20 cursor-pointer"
              : "bg-vault-warning/10 text-vault-warning hover:bg-vault-warning/20 cursor-pointer"
          }`}
          title={isSyncing || isForceSyncing ? undefined : "Clique para sincronizar agora"}
        >
          {isSyncing || isForceSyncing ? (
            <><RefreshCw size={12} className="animate-spin" /> Sincronizando...</>
          ) : (
            <><Cloud size={12} /> Alterações pendentes — clique para sincronizar</>
          )}
        </button>
      )}

      {/* Shared update notice */}
      {sharedNotice && (
        <div className="flex items-center justify-center gap-2 py-1.5 text-xs bg-vault-success/10 text-vault-success border-b border-vault-success/20">
          <RefreshCw size={12} /> {sharedNotice}
        </div>
      )}

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          onAddEntry={(groupId) => {
            setAddEntryGroupId(groupId);
            setShowAddEntry(true);
          }}
          onForceSync={handleForceSync}
          isForceSyncing={isForceSyncing}
        />

        <main className="flex-1 flex overflow-hidden">
          <PasswordGrid
            onAddEntry={(groupId) => {
              setAddEntryGroupId(groupId);
              setShowAddEntry(true);
            }}
          />
        </main>
      </div>

      {/* Add entry modal */}
      {showAddEntry && (
        <PasswordForm
          defaultGroupId={addEntryGroupId}
          onClose={() => {
            setShowAddEntry(false);
            setAddEntryGroupId(undefined);
          }}
        />
      )}
    </div>
  );
}
