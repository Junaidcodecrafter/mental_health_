import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfigLocal from '../../firebase-applet-config.json';

// Configuration prioritized: 1. Environment Variables 2. Local Config File
// This ensures credentials can be managed via secrets rather than hardcoded files.
// Note: VITE_ prefixed variables are required for client-side access in Vite.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || firebaseConfigLocal.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfigLocal.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseConfigLocal.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfigLocal.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfigLocal.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || firebaseConfigLocal.appId,
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || firebaseConfigLocal.firestoreDatabaseId,
};

if (!firebaseConfig.apiKey) {
  throw new Error("Critical: Firebase configuration is missing. Please set VITE_FIREBASE_API_KEY in your environment or provide a config file.");
}

const app = initializeApp(firebaseConfig);

// Using initializeFirestore instead of getFirestore to enable long polling
// This helps in environments where streams might be blocked
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);

// Connection Test
async function testConnection() {
  try {
    console.log('Testing Firestore connection...');
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('Firestore connection test: SUCCESS');
  } catch (error) {
    console.warn('Firestore connection test warning (safe to ignore if offline):', error);
  }
}
testConnection();
