import { initializeApp, getApps } from "firebase/app";
import { initializeAuth, getAuth, getReactNativePersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyA-KpuucR7xgY7Qth4j-VTsCz-gxuaIXVQ",
  authDomain: "takearoute-719df.firebaseapp.com",
  projectId: "takearoute-719df",
  storageBucket: "takearoute-719df.firebasestorage.app",
  messagingSenderId: "196931860484",
  appId: "1:196931860484:web:ff66a037adbdf934905d51",
  measurementId: "G-NG940VT6J3",
};

// Initialize app only once
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Initialize auth with persistence only once
let auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch (e) {
  if (e.code === "auth/already-initialized") {
    auth = getAuth(app);
  } else {
    throw e;
  }
}

const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app, "us-central1");

export { app, auth, db, storage, functions };