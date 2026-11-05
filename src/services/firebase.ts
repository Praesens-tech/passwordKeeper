import { getApp, getApps, initializeApp } from "firebase/app";
import type { FirebaseApp } from "firebase/app";
import {
  getAuth,
  inMemoryPersistence,
  initializeAuth,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
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

export interface FirebaseAccount {
  uid: string;
  email: string;
  emailVerified: boolean;
}

function accountFromUser(user: import("firebase/auth").User): FirebaseAccount {
  if (!user.email) throw new Error("A conta precisa ter um e-mail.");
  return { uid: user.uid, email: user.email, emailVerified: user.emailVerified };
}

let cached: { app: FirebaseApp; db: Firestore } | undefined;
let cachedAuth: Auth | undefined;

export function isFirebaseConfigured(): boolean {
  return Object.values(config).every((value) => typeof value === "string" && value.length > 0);
}

function getFirebase(): { app: FirebaseApp; db: Firestore } {
  if (!isFirebaseConfigured()) {
    throw new Error("O armazenamento na nuvem não está configurado neste aplicativo.");
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
      // Keep Firebase credentials in memory; do not persist another auth token.
      cachedAuth = initializeAuth(app, { persistence: inMemoryPersistence });
    } catch {
      // Handles hot reload after Auth was initialized for the same app.
      cachedAuth = getAuth(app);
    }
  }
  return cachedAuth;
}

export async function createFirebaseAccount(email: string, password: string): Promise<FirebaseAccount> {
  const credential = await createUserWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
  await sendEmailVerification(credential.user);
  return accountFromUser(credential.user);
}

export async function signInFirebaseAccount(email: string, password: string): Promise<FirebaseAccount> {
  const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
  await credential.user.reload();
  if (!credential.user.emailVerified) {
    await sendEmailVerification(credential.user);
    await signOut(getFirebaseAuth());
    throw new Error("Confirme seu e-mail pelo link enviado para entrar e acessar a nuvem.");
  }
  // Firestore rules check the email_verified claim in the ID token. Reloading
  // the Auth user updates the profile, but can leave the cached token claims
  // stale after verification in another app or browser.
  await credential.user.getIdToken(true);
  return accountFromUser(credential.user);
}

export async function getFirebaseAccount(): Promise<FirebaseAccount | null> {
  const user = getFirebaseAuth().currentUser;
  if (!user) return null;
  await user.reload();
  if (!user.emailVerified) return null;
  await user.getIdToken(true);
  return accountFromUser(user);
}

export async function requestFirebasePasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
}

export async function signOutFirebase(): Promise<void> {
  if (cachedAuth) await signOut(cachedAuth);
}

function personalVaultRef(uid: string) {
  return doc(getFirebase().db, "personalVaults", uid);
}

export async function getPersonalFirebaseVault(uid: string): Promise<{ ciphertext: string; revision: number } | null> {
  const snapshot = await getDoc(personalVaultRef(uid));
  return snapshot.exists()
    ? { ciphertext: String(snapshot.data().ciphertext ?? ""), revision: Number(snapshot.data().revision ?? 0) }
    : null;
}

export async function getLegacyPersonalFirebaseVault(email: string): Promise<{ id: string; ciphertext: string; revision: number } | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const matches = await getDocs(query(
    collection(getFirebase().db, "sharedVaults"),
    where("memberEmails", "array-contains", normalizedEmail),
  ));
  const legacy = matches.docs.find((snapshot) => {
    const data = snapshot.data() as FirebaseVaultDocument;
    return data.kind === "personal" && data.ownerEmail?.trim().toLowerCase() === normalizedEmail;
  });
  if (!legacy) return null;
  const data = legacy.data() as FirebaseVaultDocument;
  return { id: legacy.id, ciphertext: data.ciphertext, revision: Number(data.revision ?? 0) };
}

export async function savePersonalFirebaseVault(uid: string, email: string, ciphertext: string, expectedRevision?: number): Promise<number> {
  if (new TextEncoder().encode(ciphertext).byteLength > 900_000) {
    throw new Error("A cópia criptografada excede o limite da nuvem. Salve também uma cópia local.");
  }
  return runTransaction(getFirebase().db, async (transaction) => {
    const ref = personalVaultRef(uid);
    const current = await transaction.get(ref);
    const revision = current.exists() ? Number(current.data().revision ?? 0) : 0;
    if (current.exists() && (expectedRevision === undefined || revision !== expectedRevision)) {
      throw new Error("CONFLICT: o backup na nuvem foi atualizado em outro dispositivo. A sincronização foi pausada para proteger as duas versões.");
    }
    transaction.set(ref, { ciphertext, email: email.trim().toLowerCase(), revision: revision + 1, updatedAt: serverTimestamp() });
    return revision + 1;
  });
}

export function watchPersonalFirebaseVault(uid: string, onChange: (vault: { ciphertext: string; revision: number } | null) => void, onError?: (error: Error) => void): () => void {
  return onSnapshot(personalVaultRef(uid), (snapshot) => {
    onChange(snapshot.exists()
      ? { ciphertext: String(snapshot.data().ciphertext ?? ""), revision: Number(snapshot.data().revision ?? 0) }
      : null);
  }, (error) => onError?.(error));
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
    throw new Error("A cópia criptografada excede o limite da nuvem. Use também um backup local.");
  }
  await runTransaction(getFirebase().db, async (transaction) => {
    const ref = vaultRef(documentId);
    const existing = await transaction.get(ref);
    if (existing.exists()) throw new Error("Já existe um cofre na nuvem com este identificador; nenhum dado foi sobrescrito.");
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
