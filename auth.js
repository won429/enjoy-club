import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, setPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { config } from './config.js';

const auth = getAuth(initializeApp(config.firebase, 'investment-admin'));
await setPersistence(auth, browserSessionPersistence);
export const observeAuth = callback => onAuthStateChanged(auth, callback);
export const login = () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
};
export const logout = () => signOut(auth);
export const idToken = force => auth.currentUser?.getIdToken(!!force);
