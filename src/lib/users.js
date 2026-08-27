import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../../firebase'

export async function ensureUserDocument(user) {
  if (!user?.uid) {
    return
  }

  const userRef = doc(db, 'users', user.uid)
  const userSnapshot = await getDoc(userRef)

  if (userSnapshot.exists()) {
    return
  }

  
  await setDoc(userRef, {
    name: user.displayName ?? '',
    email: user.email ?? '',
    alertEmail: user.email ?? '',
    alertDays: 14,
    createdAt: serverTimestamp(),
  })
}
