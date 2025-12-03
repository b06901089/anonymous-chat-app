import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, setLogLevel } from 'firebase/firestore';

// 1. Mock the App ID
export const appId = 'local-dev-anonymous-chat'; 

// 2. Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyD3y_YAG2jXOOCuU5zMrexTUuCxP1oQvYA",
  authDomain: "anonymous-chat-app-54912.firebaseapp.com",
  projectId: "anonymous-chat-app-54912",
  storageBucket: "anonymous-chat-app-54912.firebasestorage.app",
  messagingSenderId: "796107413488",
  appId: "1:796107413488:web:d52f403871ababe1e46f35",
  measurementId: "G-LHMZSYDLBB"
};

// 3. Initialize
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Enable debug logs for development
setLogLevel('Debug');

// 4. Constants / Paths
export const CONVERSATION_PATH = `/artifacts/${appId}/public/data/conversations`;
export const WAITING_PATH = `/artifacts/${appId}/public/data/waiting_users`;

// 5. Utility: Generate ID
export function generateConversationId(userIdA, userIdB) {
  const sortedIds = [userIdA, userIdB].sort();
  return `${sortedIds[0]}_${sortedIds[1]}_${Date.now()}`;
}