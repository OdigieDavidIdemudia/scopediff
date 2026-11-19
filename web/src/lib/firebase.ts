import type { FirebaseApp } from "firebase/app";
import type { Firestore } from "firebase/firestore";

export interface AuthUser {
  uid: string;
  name: string;
  email: string | null;
  photoURL: string | null;
  provider: "demo" | "firebase";
}

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseEnabled = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId,
);

let appPromise: Promise<FirebaseApp> | null = null;

/**
 * Firebase AI Logic requires App Check. The hackathon build uses a registered
 * debug token, which the rules explicitly accept. For production, register a
 * reCAPTCHA Enterprise provider and pass its site key as VITE_RECAPTCHA_SITE_KEY.
 */
async function configureAppCheck(app: FirebaseApp): Promise<void> {
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;
  const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined;
  if (!siteKey && !debugToken) return;

  if (debugToken) {
    (
      globalThis as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }
    ).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken === "true" ? true : debugToken;
  }

  try {
    const { initializeAppCheck, ReCaptchaV3Provider } = await import("firebase/app-check");
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey || "debug-provider"),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (error) {
    // Do not let a misconfigured attestation provider take down Auth,
    // Firestore or AI Logic. App Check enforcement will still reject requests
    // if it is enabled in the Firebase project.
    console.warn("App Check initialization failed; continuing without it.", error);
  }
}

export async function getFirebaseApp(): Promise<FirebaseApp> {
  if (!appPromise) {
    appPromise = import("firebase/app").then(async ({ initializeApp, getApps, getApp }) => {
      if (getApps().length) return getApp();
      const app = initializeApp({
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        appId: config.appId,
      });
      await configureAppCheck(app);
      return app;
    });
  }
  return appPromise;
}

function mapUser(user: {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}): AuthUser {
  return {
    uid: user.uid,
    name: user.displayName || user.email?.split("@")[0] || "Hunter",
    email: user.email,
    photoURL: user.photoURL,
    provider: "firebase",
  };
}

let dbPromise: Promise<Firestore> | null = null;

export async function getDb(): Promise<Firestore> {
  if (!dbPromise) {
    dbPromise = Promise.all([import("firebase/firestore"), getFirebaseApp()]).then(
      ([{ initializeFirestore, getFirestore }, app]) => {
        try {
          return initializeFirestore(app, {
            experimentalForceLongPolling: true,
          });
        } catch {
          return getFirestore(app);
        }
      },
    );
  }
  return dbPromise;
}

export async function watchAuth(
  callback: (user: AuthUser | null) => void,
): Promise<() => void> {
  if (!firebaseEnabled) {
    callback(null);
    return () => undefined;
  }
  try {
    const [{ getAuth, onAuthStateChanged }, app] = await Promise.all([
      import("firebase/auth"),
      getFirebaseApp(),
    ]);
    const auth = getAuth(app);
    return onAuthStateChanged(auth, (user) => callback(user ? mapUser(user) : null));
  } catch {
    callback(null);
    return () => undefined;
  }
}

export async function signInWithEmail(email: string, password: string): Promise<AuthUser> {
  const [{ getAuth, signInWithEmailAndPassword }, app] = await Promise.all([
    import("firebase/auth"),
    getFirebaseApp(),
  ]);
  const result = await signInWithEmailAndPassword(getAuth(app), email, password);
  return mapUser(result.user);
}

export async function signUpWithEmail(
  email: string,
  password: string,
  name: string,
): Promise<AuthUser> {
  const [{ getAuth, createUserWithEmailAndPassword, updateProfile }, app] = await Promise.all([
    import("firebase/auth"),
    getFirebaseApp(),
  ]);
  const result = await createUserWithEmailAndPassword(getAuth(app), email, password);
  await updateProfile(result.user, { displayName: name.trim() });
  return {
    uid: result.user.uid,
    name: name.trim() || result.user.email || "Hunter",
    email: result.user.email,
    photoURL: result.user.photoURL,
    provider: "firebase",
  };
}

export async function sendPasswordReset(email: string): Promise<void> {
  const [{ getAuth, sendPasswordResetEmail }, app] = await Promise.all([
    import("firebase/auth"),
    getFirebaseApp(),
  ]);
  await sendPasswordResetEmail(getAuth(app), email);
}

export async function getAccessToken(): Promise<string | null> {
  if (import.meta.env.VITE_ALLOW_LOCAL_SESSION === "1") return "local-preview";
  if (!firebaseEnabled) return null;
  const [{ getAuth }, app] = await Promise.all([import("firebase/auth"), getFirebaseApp()]);
  const current = getAuth(app).currentUser;
  if (!current) return null;
  return current.getIdToken();
}

export async function signInWithGoogle(): Promise<AuthUser> {
  const [{ getAuth, GoogleAuthProvider, signInWithPopup }, app] = await Promise.all([
    import("firebase/auth"),
    getFirebaseApp(),
  ]);
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  return mapUser(result.user);
}

export async function signOutFirebase(): Promise<void> {
  if (!firebaseEnabled) return;
  const [{ getAuth, signOut }, app] = await Promise.all([
    import("firebase/auth"),
    getFirebaseApp(),
  ]);
  await signOut(getAuth(app));
}
