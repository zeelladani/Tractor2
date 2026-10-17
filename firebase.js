// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, getDoc,
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCi2IwwgYHRA8rxQ6yM11tqr7AhgJAKj4c",
  authDomain: "tractor-9335.firebaseapp.com",
  projectId: "tractor-9335",
  storageBucket: "tractor-9335.firebasestorage.app",
  messagingSenderId: "464420514211",
  appId: "1:464420514211:web:f4802a0cf24b8abb1c9216",
  measurementId: "G-10ZN00J02Y"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export async function signInWithGoogle() {
  const res = await signInWithPopup(auth, provider);
  return res.user;
}
export async function signOutUser() { await signOut(auth); }
export function watchAuth(cb) { return onAuthStateChanged(auth, cb); }

const userCol = (uid, name) => collection(db, "users", uid, name);
const userDoc = (uid, name, id) => doc(db, "users", uid, name, id);

export async function saveDoc(uid, colName, data, id = null) {
  // Not awaited on purpose: offline, the write is queued locally and syncs later.
  const payload = { ...data, updatedAt: serverTimestamp() };
  const fail = (e) => console.error("save failed:", e.code);
  if (id) { updateDoc(userDoc(uid, colName, id), payload).catch(fail); return id; }
  payload.createdAt = serverTimestamp();
  const ref = doc(userCol(uid, colName));
  setDoc(ref, payload).catch(fail);
  return ref.id;
}

export function watchCollection(uid, colName, orderField, cb) {
  const q = query(userCol(uid, colName), orderBy(orderField, "desc"));
  return onSnapshot(q,
    (snap) => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (err) => { console.error("watchCollection error:", err.code); cb([], err); }
  );
}

export async function deleteRecord(uid, colName, id) {
  await deleteDoc(userDoc(uid, colName, id));
}

export async function getMeta(uid, id) {
  const snap = await getDoc(userDoc(uid, "meta", id));
  return snap.exists() ? snap.data() : null;
}
export async function setMeta(uid, id, data) {
  await setDoc(userDoc(uid, "meta", id),
    { ...data, updatedAt: serverTimestamp() }, { merge: true });
}
export function watchMeta(uid, id, cb) {
  return onSnapshot(userDoc(uid, "meta", id),
    (snap) => cb(snap.exists() ? snap.data() : null));
}