import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

const missingFirebaseEnvKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key)

const firebaseConfigError =
  missingFirebaseEnvKeys.length > 0
    ? `Missing Firebase environment variables: ${missingFirebaseEnvKeys.join(', ')}`
    : ''

const app = firebaseConfigError ? null : initializeApp(firebaseConfig)
const auth = app ? getAuth(app) : null
const db = app ? getFirestore(app) : null
const googleProvider = app ? new GoogleAuthProvider() : null

if (googleProvider) {
  googleProvider.setCustomParameters({
    prompt: 'select_account',
  })
}

export {
  app,
  auth,
  db,
  googleProvider,
  firebaseConfig,
  firebaseConfigError,
  missingFirebaseEnvKeys,
}
