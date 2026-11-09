import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

// measurementId is only for Analytics, which the app doesn't load.
const optionalFirebaseKeys = new Set(['measurementId'])

const missingFirebaseEnvKeys = Object.entries(firebaseConfig)
  .filter(([key, value]) => !value && !optionalFirebaseKeys.has(key))
  .map(([key]) => key)

const firebaseConfigError =
  missingFirebaseEnvKeys.length > 0
    ? `Missing Firebase environment variables: ${missingFirebaseEnvKeys.join(', ')}`
    : ''

const app = firebaseConfigError ? null : initializeApp(firebaseConfig)
const auth = app ? getAuth(app) : null
const db = app ? getFirestore(app) : null
const googleProvider = app ? new GoogleAuthProvider() : null
const functions = app ? getFunctions(app, 'us-central1') : null

// Set VITE_FUNCTIONS_EMULATOR=true (e.g. in .env.development.local) to call
// Cloud Functions running in the local emulator instead of production.
if (functions && import.meta.env.VITE_FUNCTIONS_EMULATOR === 'true') {
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
}

if (googleProvider) {
  googleProvider.setCustomParameters({
    prompt: 'select_account',
  })
}

export {
  app,
  auth,
  db,
  functions,
  googleProvider,
  firebaseConfig,
  firebaseConfigError,
  missingFirebaseEnvKeys,
}
