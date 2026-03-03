// firebase.js

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage"; // for document uploads later

const firebaseConfig = {
  apiKey: "AIzaSyA-KpuucR7xgY7Qth4j-VTsCz-gxuaIXVQ",
  authDomain: "takearoute-719df.firebaseapp.com",
  projectId: "takearoute-719df",
  storageBucket: "takearoute-719df.firebasestorage.app",
  messagingSenderId: "196931860484",
  appId: "1:196931860484:web:ff66a037adbdf934905d51",
  measurementId: "G-NG940VT6J3"
};

const app = initializeApp(firebaseConfig);

// 🔐 Authentication
export const auth = getAuth(app);

// 🗄 Firestore Database
export const db = getFirestore(app);

// ☁️ Storage (for license, documents later)
export const storage = getStorage(app);

export default app;
