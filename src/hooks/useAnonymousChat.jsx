import { useState, useEffect } from 'react';
import { 
  signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';
import { 
  doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, 
  deleteDoc, runTransaction, getDocs, serverTimestamp, limit 
} from 'firebase/firestore';
import { auth, db, CONVERSATION_PATH, WAITING_PATH, generateConversationId } from '../services/firebase';

export const useAnonymousChat = () => {
  // --- State ---
  const [userId, setUserId] = useState(null);
  const [status, setStatus] = useState('IDLE'); // IDLE, JOINING, WAITING, CHATTING, ENDED
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [partnerId, setPartnerId] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isAuthReady, setIsAuthReady] = useState(false);

  // --- 1. Authentication ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
      } else {
        try {
          await signInAnonymously(auth);
        } catch (error) {
          console.error("Auth failed:", error);
          setErrorMessage("Authentication failed.");
        }
      }
      setIsAuthReady(true);
    });
    return unsubscribe;
  }, []);

  // --- 2. Heartbeat (Web Worker) ---
  useEffect(() => {
    let worker;
    if (status === 'WAITING' && userId) {
      const workerCode = `
        let intervalId;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            intervalId = setInterval(() => { self.postMessage('tick'); }, 5000);
          } else if (e.data === 'stop') { clearInterval(intervalId); }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      worker = new Worker(URL.createObjectURL(blob));

      worker.onmessage = async () => {
        try {
          await updateDoc(doc(db, WAITING_PATH, userId), { lastSeen: serverTimestamp() });
          console.log("Heartbeat sent (via Worker)...");
        } catch (e) {
          worker.terminate();
        }
      };
      worker.postMessage('start');
    }
    return () => {
      if (worker) {
        worker.postMessage('stop');
        worker.terminate(); 
      }
    };
  }, [status, userId]);

  // --- 3. Chat Listener ---
  useEffect(() => {
    if (status !== 'CHATTING' || !conversationId) {
      setMessages([]);
      return;
    }
    // Listen for real-time updates to the conversation document
    const unsub = onSnapshot(doc(db, CONVERSATION_PATH, conversationId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();

        // SCENARIO 1: The chat is fully dead (Both left)
        if (data.status === 'ENDED') {
          setMessages(prev => [...prev, { 
            id: Date.now(), text: "🚨 Chat closed.", senderId: 'SYSTEM', timestamp: new Date() 
          }]);
          setTimeout(() => resetChatState('ENDED'), 3000);
          return;
        }

        const amUserA = data.userAId === userId;
        const partnerHasLeft = amUserA ? data.userHasLeftB : data.userHasLeftA;
        if (partnerHasLeft) setPartnerId(pid => pid.includes('Disconnected') ? pid : `${pid} (Disconnected)`);

        const msgs = data.messages || [];
        msgs.sort((a, b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
        setMessages(msgs);
      } else {
        resetChatState('ENDED');
      }
    });
    return () => unsub();
  }, [status, conversationId, userId]);

  // --- 4. Match Listener (While Waiting) ---
  useEffect(() => {
    if (status !== 'WAITING' || !userId) return;

    const handleMatch = (snapshot) => {
      if (!snapshot.empty) {
        const docData = snapshot.docs[0].data();
        const convId = snapshot.docs[0].id;
        const partner = docData.userAId === userId ? docData.userBId : docData.userAId;
        
        console.log("Match detected via Listener!");

        setConversationId(convId);
        setPartnerId(partner);
        setStatus('CHATTING');
      }
    };

    const q1 = query(collection(db, CONVERSATION_PATH), where('userAId', '==', userId), where('status', '==', 'active'));
    const q2 = query(collection(db, CONVERSATION_PATH), where('userBId', '==', userId), where('status', '==', 'active'));
    
    const unsub1 = onSnapshot(q1, handleMatch);
    const unsub2 = onSnapshot(q2, handleMatch);
    return () => { unsub1(); unsub2(); };
  }, [status, userId]);

  // --- Actions ---

  const joinChat = async () => {
    if (!userId) return;
    setErrorMessage('');
    setStatus('JOINING');

    try {
      const q = query(collection(db, WAITING_PATH), limit(10));
      const snapshot = await getDocs(q);
      
      let validPartnerDoc = null;
      for (const candidate of snapshot.docs) {
        const data = candidate.data();
        if (data.userId === userId) continue;
        if (Date.now() - (data.lastSeen?.toMillis() || 0) > 15000) {
          deleteDoc(candidate.ref).catch(() => {}); // Cleanup ghost
          console.log(`Found ghost user ${data.userId}. Deleting...`);
          continue;
        }
        validPartnerDoc = candidate;
        break;
      }

      if (validPartnerDoc) {
        // Candidate found! Now try to claim them atomically.
        await runTransaction(db, async (transaction) => {
          // A. Re-read the candidate inside the transaction to ensure they are still there
          const freshDoc = await transaction.get(validPartnerDoc.ref);
          if (!freshDoc.exists()) throw new Error("Partner was taken just now!");
          
          // B. Delete them from waiting (Claim them)
          transaction.delete(validPartnerDoc.ref);
          console.log("Claimed partner, removed from waiting list.");
          
          const pid = freshDoc.data().userId;
          const convId = generateConversationId(userId, pid);
          const newConvRef = doc(db, CONVERSATION_PATH, convId);
          console.log("Creating conversation with ID:", convId);
          
          // C. Final safety net: prevent self-matching
          if (pid === userId) throw new Error("ABORT: Attempted to match with self.");

          transaction.set(newConvRef, {
            userAId: userId, userBId: pid, status: 'active', createdAt: serverTimestamp(),
            messages: [{ text: "Connected!", senderId: 'SYSTEM', timestamp: new Date() }]
          });
          console.log("Conversation document created.");

          return { convId, pid };
        }).then(res => {
          setConversationId(res.convId);
          setPartnerId(res.pid);
          setStatus('CHATTING');
        }).catch(async (e) => {
           console.log("Match failed, adding self to wait list instead.", e);
           await joinWaitingList();
        });
      } else {
        await joinWaitingList();
      }
    } catch (e) {
      console.error("Join Chat Error:", e);
      setErrorMessage("Error joining.");
      setStatus('IDLE');
    }
  };

  const joinWaitingList = async () => {
    await setDoc(doc(db, WAITING_PATH, userId), {
      userId, joinedAt: serverTimestamp(), lastSeen: serverTimestamp()
    });
    setStatus('WAITING');
  };

  const sendMessage = async (text) => {
    if (!text.trim() || status !== 'CHATTING') return;
    const newMessage = { text: text.trim(), senderId: userId, timestamp: new Date() };
    
    // Optimistic Update
    setMessages(prev => [...prev, newMessage]); 
    
    try {
      await updateDoc(doc(db, CONVERSATION_PATH, conversationId), {
        messages: [...messages, newMessage]
      });
    } catch (e) {
      console.error(e);
      setErrorMessage("Failed to send.");
    }
  };

  const leaveChat = async () => {
    if (status === 'CHATTING' && conversationId) {
      const convRef = doc(db, CONVERSATION_PATH, conversationId);
      const snap = await getDoc(convRef);
      if (snap.exists()) {
        const data = snap.data();
        const isUserA = data.userAId === userId;
        const updateData = {
          [`userHasLeft${isUserA ? 'A' : 'B'}`]: true,
          messages: [...(data.messages||[]), { 
            text: `SYSTEM: User has left the chat.`, 
            senderId: 'SYSTEM', 
            timestamp: new Date() 
          }]
        };
        if ((isUserA && data.userHasLeftB) || (!isUserA && data.userHasLeftA)) {
          updateData.status = 'ENDED';
        }
        await updateDoc(convRef, updateData);
      }
    } else if (status === 'WAITING') {
      await deleteDoc(doc(db, WAITING_PATH, userId));
    }
    resetChatState('IDLE');
  };

  const resetChatState = (s) => {
    setStatus(s);
    setConversationId(null);
    setPartnerId(null);
    setMessages([]);
    setErrorMessage('');
  };

  return {
    userId, status, messages, partnerId, errorMessage, isAuthReady,
    joinChat, leaveChat, sendMessage
  };
};