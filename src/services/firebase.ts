import { getApp, getApps, initializeApp } from "firebase/app";
import type { FirebaseApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  inMemoryPersistence,
  initializeAuth,
  signInWithCredential,
  signOut,
} from "firebase/auth";
import type { Auth } from "firebase/auth";
import {
  Firestore,
  doc,
  collection,
  getDoc,
  getFirestore,
  onSnapshot,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  deleteDoc,
} from "firebase/firestore";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export interface FirebaseVaultDocument {
  /** Envelope v2 cifrado pelo cliente. O Firestore nunca recebe VaultData em claro. */
  ciphertext: string;
  ownerUid: string;
  memberUids: string[];
  editorUids: string[];
  ownerEmail?: string;
  memberEmails?: string[];
  editorEmails?: string[];
  kind?: "personal" | "collaboration";
  collaboration?: { documentId: string; type: string; title: string; createdFromId?: string; createdAt: string };
  revision: number;
  updatedAt?: unknown;
}

export interface FirebaseVaultAccess {
  ownerUid: string;
  memberUids: string[];
  editorUids: string[];
  ownerEmail?: string;
  memberEmails?: string[];
  editorEmails?: string[];
  kind?: "personal" | "collaboration";
  collaboration?: FirebaseVaultDocument["collaboration"];
}

let cached: { app: FirebaseApp; db: Firestore } | undefined;
let cachedAuth: Auth | undefined;

export function isFirebaseConfigured(): boolean {
  return Object.values(config).every((value) => typeof value === "string" && value.length > 0);
}

function getFirebase(): { app: FirebaseApp; db: Firestore } {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase não configurado. Preencha as variáveis VITE_FIREBASE_* no arquivo .env.");
  }
  if (!cached) {
    const app = getApps().length ? getApp() : initializeApp(config as {
      apiKey: string;
      authDomain: string;
      projectId: string;
      appId: string;
    });
    cached = { app, db: getFirestore(app) };
  }
  return cached;
}

function getFirebaseAuth(): Auth {
  const app = getFirebase().app;
  if (!cachedAuth) {
    try {
      // Google credentials already live in the Tauri store. Keep Firebase's
      // derived session in memory instead of persisting another auth token.
      cachedAuth = initializeAuth(app, { persistence: inMemoryPersistence });
    } catch {
      // Handles hot reload after Auth was initialized for the same app.
      cachedAuth = getAuth(app);
    }
  }
  return cachedAuth;
}

export interface FirebaseUserIdentity {
  uid: string;
  email: string | null;
}

export async function signInFirebaseWithGoogleToken(accessToken: string): Promise<FirebaseUserIdentity> {
  if (!accessToken) throw new Error("Conecte sua conta Google antes de acessar o Firebase.");
  const credential = GoogleAuthProvider.credential(null, accessToken);
  const result = await signInWithCredential(getFirebaseAuth(), credential);
  return { uid: result.user.uid, email: result.user.email };
}

export async function signOutFirebase(): Promise<void> {
  if (cachedAuth) await signOut(cachedAuth);
}

export function firebaseDocumentIdForDriveFile(fileId: string): string {
  return `drive-${fileId}`;
}

function vaultRef(documentId: string) {
  return doc(getFirebase().db, "sharedVaults", documentId);
}

/** Cria o registro inicial. A regra Firestore exige usuário autenticado e ownerUid == UID. */
export async function createFirebaseVault(
  documentId: string,
  ciphertext: string,
  access: FirebaseVaultAccess,
): Promise<void> {
  const data = {
    ciphertext,
    ownerUid: access.ownerUid,
    memberUids: [...new Set([access.ownerUid, ...access.memberUids])],
    editorUids: [...new Set(access.editorUids)],
    ownerEmail: access.ownerEmail ?? "",
    memberEmails: [...new Set([access.ownerEmail, ...(access.memberEmails ?? [])]
      .filter((email): email is string => !!email).map((email) => email.trim().toLowerCase()))],
    editorEmails: [...new Set((access.editorEmails ?? []).map((email) => email.trim().toLowerCase()))],
    kind: access.kind ?? "personal",
    ...(access.collaboration ? { collaboration: access.collaboration } : {}),
    revision: 1,
    updatedAt: serverTimestamp(),
  } satisfies FirebaseVaultDocument;
  if (new TextEncoder().encode(ciphertext).byteLength > 900_000) {
    throw new Error("O cofre cifrado excede o limite seguro do Firestore. Use um backup local e solicite a migração para arquivos maiores.");
  }
  await runTransaction(getFirebase().db, async (transaction) => {
    const ref = vaultRef(documentId);
    const existing = await transaction.get(ref);
    if (existing.exists()) throw new Error("Já existe um cofre Firebase com este identificador; nenhum dado foi sobrescrito.");
    transaction.set(ref, data);
  });
}

export async function listFirebaseSharesForEmail(email: string): Promise<Array<FirebaseVaultDocument & { id: string }>> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return [];
  const shares = await getDocs(query(
    collection(getFirebase().db, "sharedVaults"),
    where("memberEmails", "array-contains", normalizedEmail),
  ));
  return shares.docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() as FirebaseVaultDocument }))
    .filter((document) => document.kind === "collaboration");
}

export async function deleteFirebaseVault(documentId: string): Promise<void> {
  await deleteDoc(vaultRef(documentId));
}

/** Atualiza somente o envelope cifrado; regras Firestore validam editor/owner. */
export async function updateFirebaseVault(
  documentId: string,
  ciphertext: string,
  expectedRevision?: number,
): Promise<number> {
  const ref = vaultRef(documentId);
  return runTransaction(getFirebase().db, async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists()) throw new Error("Cofre compartilhado não encontrado.");
    const revision = Number(current.data().revision ?? 0);
    if (expectedRevision !== undefined && revision !== expectedRevision) {
      throw new Error("CONFLICT: o cofre foi alterado em outro dispositivo. Sincronize antes de salvar.");
    }
    transaction.update(ref, {
      ciphertext,
      revision: revision + 1,
      updatedAt: serverTimestamp(),
    });
    return revision + 1;
  });
}

export async function updateFirebaseShareAccess(
  documentId: string,
  memberEmails: string[],
  editorEmails: string[],
): Promise<number> {
  const ref = vaultRef(documentId);
  return runTransaction(getFirebase().db, async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists()) throw new Error("Compartilhamento não encontrado.");
    const revision = Number(current.data().revision ?? 0) + 1;
    transaction.update(ref, {
      memberEmails: [...new Set(memberEmails.map((email) => email.trim().toLowerCase()))],
      editorEmails: [...new Set(editorEmails.map((email) => email.trim().toLowerCase()))],
      revision,
      updatedAt: serverTimestamp(),
    });
    return revision;
  });
}

export async function getFirebaseVault(documentId: string): Promise<FirebaseVaultDocument | null> {
  const snapshot = await getDoc(vaultRef(documentId));
  return snapshot.exists() ? snapshot.data() as FirebaseVaultDocument : null;
}

export function watchFirebaseVault(
  documentId: string,
  onChange: (document: FirebaseVaultDocument | null) => void,
  onError?: (error: Error) => void,
): () => void {
  return onSnapshot(vaultRef(documentId), (snapshot) => {
    onChange(snapshot.exists() ? snapshot.data() as FirebaseVaultDocument : null);
  }, (error) => onError?.(error));
}
