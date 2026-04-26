import { createContext, useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { auth, firebaseConfigError, googleProvider } from '../../firebase'
import { ensureUserDocument } from '../lib/users'

const AuthContext = createContext(null)

function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!auth) {
      setCurrentUser(null)
      setLoading(false)
      return undefined
    }

    let isMounted = true

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (isMounted) {
        setLoading(true)
      }

      try {
        if (user) {
          await ensureUserDocument(user)
        }

        if (isMounted) {
          setCurrentUser(user)
        }
      } catch (error) {
        console.error('Failed to sync the authenticated user to Firestore.', error)

        if (isMounted) {
          setCurrentUser(user)
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  const signInWithGoogle = async () => {
    if (!auth || !googleProvider) {
      throw new Error(firebaseConfigError || 'Firebase is not configured.')
    }

    return signInWithPopup(auth, googleProvider)
  }

  const signOut = async () => {
    if (!auth) {
      return
    }

    return firebaseSignOut(auth)
  }

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        loading,
        signInWithGoogle,
        signOut,
        configError: firebaseConfigError,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export { AuthContext, AuthProvider }
