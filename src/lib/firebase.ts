import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

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
    // Attempting to get a document from the specific database
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('Firestore connection test: SUCCESS (or reached backend)');
  } catch (error) {
    console.error('Firestore connection test error:', error);
    if (error instanceof Error) {
      if (error.message.includes('the client is offline') || error.message.includes('unavailable')) {
        console.error("CRITICAL: Firestore is unreachable. Please verify network connectivity and Firebase configuration.");
      }
    }
  }
}
testConnection();
