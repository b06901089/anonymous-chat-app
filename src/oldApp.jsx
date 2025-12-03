import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, initializeFirestore, doc, getDoc, setDoc, addDoc, updateDoc, onSnapshot, 
  collection, query, where, deleteDoc, runTransaction, getDocs, serverTimestamp, 
  limit 
} from 'firebase/firestore';
import { setLogLevel } from 'firebase/firestore';

// 1. Mock the App ID (used for Firestore pathing)
const appId = 'local-dev-anonymous-chat'; 

// 2. Mock the Firebase Config (PASTE YOUR ACTUAL CONFIG HERE)
const firebaseConfig = {
  apiKey: "AIzaSyD3y_YAG2jXOOCuU5zMrexTUuCxP1oQvYA",
  authDomain: "anonymous-chat-app-54912.firebaseapp.com",
  projectId: "anonymous-chat-app-54912",
  storageBucket: "anonymous-chat-app-54912.firebasestorage.app",
  messagingSenderId: "796107413488",
  appId: "1:796107413488:web:d52f403871ababe1e46f35",
  measurementId: "G-LHMZSYDLBB"
};

// 3. Mock the Auth Token (Not needed for anonymous sign-in, keep null)
const initialAuthToken = null; 

// The application's core data paths in Firestore (These automatically use your local 'appId')
const CONVERSATION_PATH = `/artifacts/${appId}/public/data/conversations`;
const WAITING_PATH = `/artifacts/${appId}/public/data/waiting_users`;


// --- Utility Functions ---

/**
 * Ensures the app and services are initialized and attempts sign-in.
 * @returns {{db: Firestore | null, auth: Auth | null}}
 */
function initializeFirebase() {
  if (Object.keys(firebaseConfig).length === 0) {
    console.error("Firebase config is missing. Cannot initialize Firestore.");
    return { db: null, auth: null };
  }
  try {
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const auth = getAuth(app);
    setLogLevel('Debug'); // Enable debug logs for Firestore
    return { db, auth };
  } catch (e) {
    console.error("Error initializing Firebase:", e);
    return { db: null, auth: null };
  }
}

/**
 * Generates a unique ID for a new conversation document.
 * @param {string} userIdA
 * @param {string} userIdB
 * @returns {string} A combined, sortable conversation ID.
 */
function generateConversationId(userIdA, userIdB) {
  // Sort user IDs alphabetically to ensure consistency regardless of who initiated the chat
  const sortedIds = [userIdA, userIdB].sort();
  return `${sortedIds[0]}_${sortedIds[1]}_${Date.now()}`;
}


// --- Main React Component ---

const App = () => {
  // Firebase State
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  // App State
  const [status, setStatus] = useState('IDLE'); // IDLE, JOINING, WAITING, CHATTING, ENDED
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [partnerId, setPartnerId] = useState(null);
  const [messageInput, setMessageInput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Ref for auto-scrolling
  const messagesEndRef = useRef(null);

  // Handle Browser Refresh/Close
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (status === 'WAITING' && userId) {
        // Attempt to delete the waiting doc before the browser closes
        // Note: This is "best effort" and works 80% of the time
        const waitingRef = doc(db, WAITING_PATH, userId);
        deleteDoc(waitingRef).catch(err => console.error("Cleanup failed", err));
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [status, userId, db]); // Dependencies ensure we have latest state

  // // Heartbeat to keep waiting status "Fresh"
  // useEffect(() => {
  //   let interval;
  //   if (status === 'WAITING' && userId && db) {
  //     interval = setInterval(async () => {
  //       const waitingRef = doc(db, WAITING_PATH, userId);
  //       try {
  //         // Update lastSeen every 10 seconds
  //         await updateDoc(waitingRef, {
  //           lastSeen: serverTimestamp()
  //         });
  //         console.log("Heartbeat sent...");
  //       } catch (e) {
  //         // If we can't update (e.g. document deleted because we matched), stop loop
  //         console.log("Heartbeat stopped (matched or error).");
  //         clearInterval(interval);
  //       }
  //     }, 10000); // 10 seconds
  //   }
  //   return () => clearInterval(interval);
  // }, [status, userId, db]);
  
  // NEW: Robust Heartbeat using Web Worker (Works in background tabs)
  useEffect(() => {
    let worker;

    if (status === 'WAITING' && userId && db) {
      // 1. Define the worker code as a string
      // This simple script just sends a 'tick' message every 5 seconds
      const workerCode = `
        let intervalId;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            intervalId = setInterval(() => {
              self.postMessage('tick');
            }, 5000); // 5 seconds
          } else if (e.data === 'stop') {
            clearInterval(intervalId);
          }
        };
      `;

      // 2. Create a Blob from the code string (Simulates a separate file)
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      worker = new Worker(URL.createObjectURL(blob));

      // 3. Listen for the 'tick' from the worker
      worker.onmessage = async () => {
        // This code runs on the Main Thread when the worker pings us
        const waitingRef = doc(db, WAITING_PATH, userId);
        try {
          await updateDoc(waitingRef, {
            lastSeen: serverTimestamp()
          });
          console.log("Heartbeat sent (via Worker)...");
        } catch (e) {
          if (e.code === 'not-found' || e.message.includes("No document")) {
             console.log("Heartbeat skipped: Document gone (Likely Matched!)");
          } else {
             console.error("Heartbeat error:", e);
          }
          worker.terminate();
        }
      };

      // 4. Start the worker
      worker.postMessage('start');
    }

    // Cleanup: Terminate worker when status changes or component unmounts
    return () => {
      if (worker) {
        worker.postMessage('stop');
        worker.terminate();
      }
    };
  }, [status, userId, db]);

  // 1. Firebase Initialization and Authentication
  useEffect(() => {
    const { db, auth } = initializeFirebase();
    if (!db || !auth) return;

    setDb(db);
    setAuth(auth);

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
      } else {
        // Sign in if not authenticated (using token or anonymously)
        try {
          if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
          } else {
            await signInAnonymously(auth);
          }
        } catch (error) {
          console.error("Authentication failed:", error);
          setErrorMessage("Failed to authenticate. Check console for details.");
        }
      }
      setIsAuthReady(true);
    });

    return () => {
      // Clean up previous conversation state on component unmount
      if (conversationId && userId && status === 'CHATTING') {
        leaveChat(conversationId, userId); 
      }
      unsubscribe();
    };
  }, []);

  // 2. Chat Listener (Reacts to changes in conversationId)
  useEffect(() => {
    if (!db || !isAuthReady || status !== 'CHATTING' || !conversationId) {
      setMessages([]); // Clear messages when not chatting
      return;
    }

    const convRef = doc(db, CONVERSATION_PATH, conversationId);
    
    // Listen for real-time updates to the conversation document
    const unsubscribe = onSnapshot(convRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();

        // SCENARIO 1: The chat is fully dead (Both left)
        if (data.status === 'ENDED') {
          setMessages(prev => [...prev, { 
            id: Date.now(), 
            text: "🚨 Chat closed. Both users have disconnected.", 
            senderId: 'SYSTEM', 
            timestamp: new Date() 
          }]);
          setTimeout(() => resetChatState('ENDED'), 3000);
          return;
        }

        // SCENARIO 2: Check if PARTNER has left (But I am still here)
        // We calculate if the *other* person has the 'Left' flag
        const amUserA = data.userAId === userId;
        const partnerHasLeft = amUserA ? data.userHasLeftB : data.userHasLeftA;

        // If partner left, we just ensure we show the messages. 
        // We DO NOT change our local status. We stay in 'CHATTING'.
        
        const newMessages = data.messages || [];
        newMessages.sort((a, b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
        setMessages(newMessages);

        // Optional: Update UI partner name to indicate they are gone
        if (partnerHasLeft) {
          setPartnerId(`${partnerId} (Disconnected)`);
        }

      } else {
        // Document deleted or not found (shouldn't happen in this flow)
        console.error("Conversation document not found.");
        resetChatState('ENDED');
      }
    }, (error) => {
      console.error("Error listening to conversation:", error);
      setErrorMessage("Real-time connection error. See console.");
      resetChatState('ENDED');
    });

    return () => unsubscribe();
  }, [db, isAuthReady, status, conversationId]);

  // 3. Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 4. Core Logic: Joining and Matching
  const handleJoinChat = async () => {
    if (!db || !userId) {
      setErrorMessage("User or Database not ready.");
      return;
    }

    setErrorMessage('');
    setStatus('JOINING');

    const waitingCollectionRef = collection(db, WAITING_PATH);

    try {
      // --- STEP 1: Search for a FRESH partner ---
      const q = query(waitingCollectionRef, limit(10));
      const snapshot = await getDocs(q);

      let validPartnerDoc = null;

      // Iterate through candidates to find a "Live" one
      for (const candidate of snapshot.docs) {
        const data = candidate.data();
        
        // 1. Skip myself
        if (data.userId === userId) continue;

        // 2. Check for Stale Users (Ghosts)
        // Convert Firestore Timestamp to millis
        const lastSeenMillis = data.lastSeen?.toMillis() || 0;
        const nowMillis = Date.now();
        const timeSinceLastSeen = nowMillis - lastSeenMillis;

        // If they haven't pinged in > 15 seconds, they are gone/disconnected
        if (timeSinceLastSeen > 15000) { 
          console.log(`Found ghost user ${data.userId} (inactive ${timeSinceLastSeen}ms). Deleting...`);
          // Clean up the garbage (fire and forget)
          deleteDoc(candidate.ref).catch(e => console.warn("Could not delete ghost", e));
          continue; // Skip this user
        }

        // If we get here, this user is fresh and valid!
        validPartnerDoc = candidate;
        break; // Stop looking, we found one
      }

      // --- STEP 2: Determine Action ---
      if (!snapshot.empty) {
        // Candidate found! Now try to claim them atomically.
        const candidateDoc = snapshot.docs[0];
        const partnerId = candidateDoc.data().userId;
        console.log(`Attempting to claim partner: ${partnerId}`);

        await runTransaction(db, async (transaction) => {
          // A. Re-read the candidate inside the transaction to ensure they are still there
          const freshPartnerDoc = await transaction.get(candidateDoc.ref);
          console.log("Re-checked candidate inside transaction.");

          if (!freshPartnerDoc.exists()) {
            throw new Error("Partner was taken just now!"); // Triggers retry/fallback
          }

          // B. Delete them from waiting (Claim them)
          transaction.delete(candidateDoc.ref);
          console.log("Claimed partner, removed from waiting list.");

          // C. Final safety net: prevent self-matching
          if (partnerId === userId) {
            throw new Error("ABORT: Attempted to match with self.");
          }

          // D. Create the conversation
          const convId = generateConversationId(userId, partnerId);
          const newConvRef = doc(db, CONVERSATION_PATH, convId);
          console.log("Creating conversation with ID:", convId);

          const conversationData = {
            userAId: userId,
            userBId: partnerId,
            status: 'active',
            createdAt: serverTimestamp(),
            messages: [{
              text: "You are now connected! Say hello.",
              senderId: 'SYSTEM',
              timestamp: new Date()
            }]
          };

          // Use set with merge:true or check existence to prevent overwriting if partner also tried
          transaction.set(newConvRef, conversationData);
          console.log("Conversation document created.");
          
          return { status: 'MATCHED', convId, partnerId };
        })
        .then((result) => {
          // Success: Update State
          setConversationId(result.convId);
          setPartnerId(result.partnerId);
          setStatus('CHATTING');
        })
        .catch(async (e) => {
           console.log("Match failed (race condition), adding self to wait list instead.", e);
           // If the "grab" failed, fall back to adding ourselves to the waiting list
           await joinWaitingList();
        });

      } else {
        // No one found, add self to waiting list
        await joinWaitingList();
      }

    } catch (e) {
      console.error("Join Chat Error:", e);
      setErrorMessage("Error joining chat. Check console.");
      setStatus('IDLE');
    }
  };

  // Helper to add self to waiting list
  const joinWaitingList = async () => {
    const waitingDocRef = doc(db, WAITING_PATH, userId);
    await setDoc(waitingDocRef, {
      userId: userId,
      joinedAt: serverTimestamp(),
      lastSeen: serverTimestamp()
    });
    setStatus('WAITING');
  };

  // 5. LISTENER: Wait for a Match
  useEffect(() => {
    if (status !== 'WAITING' || !userId || !db) return;

    // We listen for any conversation where I am User A or User B
    const q1 = query(
      collection(db, CONVERSATION_PATH), 
      where('userAId', '==', userId), 
      where('status', '==', 'active')
    );
    
    const q2 = query(
      collection(db, CONVERSATION_PATH), 
      where('userBId', '==', userId), 
      where('status', '==', 'active')
    );

    const handleMatch = (snapshot) => {
      if (!snapshot.empty) {
        // MATCH FOUND!
        const docData = snapshot.docs[0].data();
        const convId = snapshot.docs[0].id;
        const partner = docData.userAId === userId ? docData.userBId : docData.userAId;

        console.log("Match detected via Listener!");
        
        // Update state to CHATTING (This stops the Heartbeat automatically)
        setConversationId(convId);
        setPartnerId(partner);
        setStatus('CHATTING');
      }
    };

    // Attach listeners
    const unsub1 = onSnapshot(q1, handleMatch);
    const unsub2 = onSnapshot(q2, handleMatch);

    // Cleanup listeners when we stop waiting
    return () => {
      unsub1();
      unsub2();
    };
  }, [status, userId, db]);

  // 6. Send Message
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!messageInput.trim() || status !== 'CHATTING' || !conversationId) return;

    const convRef = doc(db, CONVERSATION_PATH, conversationId);
    
    const newMessage = {
      text: messageInput.trim(),
      senderId: userId,
      timestamp: new Date() // Use client-side date for optimistic update/sorting
    };

    // Optimistic update (optional but improves UX)
    setMessages(prev => [...prev, {...newMessage, timestamp: new Date()}]); 

    try {
      // Add the new message to the existing array in the conversation document
      await updateDoc(convRef, {
        messages: [...messages, {...newMessage, timestamp: new Date()}]
      });
      setMessageInput('');
    } catch (error) {
      console.error("Error sending message:", error);
      setErrorMessage("Failed to send message.");
      // Rollback optimistic update if necessary
    }
  };

  // 7. Leave Chat (Updated to allow the other person to stay)
  const leaveChat = async (convId, currentUserId) => {
    if (!db || !convId) return;

    const convRef = doc(db, CONVERSATION_PATH, convId);
    const waitingRef = doc(db, WAITING_PATH, currentUserId);

    try {
      // 1. Fetch the conversation to see if we are User A or User B
      const convSnap = await getDoc(convRef);
      if (convSnap.exists()) {
        const data = convSnap.data();
        const isUserA = data.userAId === currentUserId;

        // 2. Prepare update data
        const updateData = {
          messages: [...(data.messages || []), { 
            text: `SYSTEM: User ${currentUserId.substring(0, 8)}... has left the chat.`, 
            senderId: 'SYSTEM', 
            timestamp: new Date()
          }]
        };

        // 3. Mark the specific user as left
        if (isUserA) {
          updateData.userHasLeftA = true;
        } else {
          updateData.userHasLeftB = true;
        }

        // 4. ONLY set global status to ENDED if BOTH have left
        if ((isUserA && data.userHasLeftB) || (!isUserA && data.userHasLeftA)) {
          updateData.status = 'ENDED';
        }

        await updateDoc(convRef, updateData);
      }
    } catch (e) {
      console.warn("Error updating conversation on leave:", e);
    }
    
    // 5. Cleanup Waiting List (standard)
    try {
      await deleteDoc(waitingRef);
    } catch (e) {
      // Ignore
    }

    // 6. Reset MY local state (I am leaving, so I go to IDLE)
    resetChatState('IDLE');
  };

  const handleLeaveChatClick = () => {
    if (conversationId) {
      leaveChat(conversationId, userId);
    } else if (status === 'WAITING') {
      // If waiting, just remove them from the queue
      const waitingRef = doc(db, WAITING_PATH, userId);
      deleteDoc(waitingRef).then(() => {
        resetChatState('IDLE');
        console.log("Removed from waiting queue.");
      }).catch(e => {
        resetChatState('IDLE');
        console.error("Failed to leave waiting queue:", e);
      });
    }
  };

  const resetChatState = (newStatus = 'IDLE') => {
    setStatus(newStatus);
    setConversationId(null);
    setPartnerId(null);
    setMessages([]);
    setErrorMessage('');
    setMessageInput('');
  }

  // --- Render Helpers ---

  const renderStatusButton = () => {
    switch (status) {
      case 'IDLE':
        return (
          <button 
            onClick={handleJoinChat} 
            disabled={!isAuthReady || !db || status === 'JOINING'}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition duration-150 ease-in-out disabled:opacity-50"
          >
            {status === 'JOINING' ? 'Searching...' : 'Join Anonymous Chat'}
          </button>
        );
      case 'JOINING':
        return (
          <button 
            disabled 
            className="w-full bg-blue-500 text-white font-bold py-3 px-4 rounded-xl shadow-lg opacity-70 cursor-not-allowed"
          >
            Matching...
          </button>
        );
      case 'WAITING':
        return (
          <button 
            onClick={handleLeaveChatClick} 
            className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold py-3 px-4 rounded-xl shadow-lg transition duration-150 ease-in-out"
          >
            Waiting for a Partner... (Click to Cancel)
          </button>
        );
      case 'CHATTING':
        return (
          <button 
            onClick={handleLeaveChatClick} 
            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition duration-150 ease-in-out"
          >
            End Chat
          </button>
        );
      case 'ENDED':
        return (
          <button 
            onClick={() => resetChatState('IDLE')} 
            className="w-full bg-gray-500 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition duration-150 ease-in-out"
          >
            Chat Ended. Start New Chat
          </button>
        );
      default:
        return null;
    }
  };

  const renderChatWindow = () => {
    if (status !== 'CHATTING' && status !== 'ENDED' && status !== 'WAITING') return null;

    return (
      <div className="flex flex-col h-full bg-white border border-gray-200 rounded-xl shadow-inner mt-6">
        {/* Header */}
        <div className="p-4 border-b bg-gray-50 rounded-t-xl">
          {status === 'CHATTING' && (
            <p className="text-lg font-semibold text-gray-800">
              Chatting Anonymously with: <span className="text-blue-600">{partnerId ? partnerId.substring(0, 8) + '...' : 'Loading...'}</span>
            </p>
          )}
          {(status === 'WAITING' || status === 'ENDED') && (
            <p className="text-lg font-semibold text-gray-500">
              {status === 'WAITING' ? 'Please wait for a match.' : 'Conversation History'}
            </p>
          )}
        </div>

        {/* Messages Container */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3">
          {messages.map((msg, index) => (
            <div 
              key={index} 
              className={`flex ${msg.senderId === userId ? 'justify-end' : msg.senderId === 'SYSTEM' ? 'justify-center' : 'justify-start'}`}
            >
              <div 
                className={`max-w-xs md:max-w-md lg:max-w-lg px-4 py-2 rounded-xl shadow-md ${
                  msg.senderId === userId 
                    ? 'bg-blue-500 text-white rounded-br-none' 
                    : msg.senderId === 'SYSTEM' 
                      ? 'bg-yellow-100 text-gray-700 text-center rounded-lg italic'
                      : 'bg-gray-200 text-gray-800 rounded-tl-none'
                }`}
              >
                {msg.senderId !== 'SYSTEM' && (
                    <div className="text-xs opacity-75 mb-1 font-semibold">
                      {msg.senderId === userId ? 'You' : 'Partner'}
                    </div>
                )}
                {msg.text}
                <div className="text-xs mt-1 text-right opacity-50">
                    {msg.timestamp?.toDate ? msg.timestamp.toDate().toLocaleTimeString() : '...'}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Message Input */}
        {status === 'CHATTING' && (
          <form onSubmit={handleSendMessage} className="p-4 border-t bg-gray-50 rounded-b-xl">
            <div className="flex space-x-3">
              <input
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder="Type your anonymous message..."
                className="flex-1 border border-gray-300 p-3 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-150"
                disabled={status !== 'CHATTING'}
              />
              <button 
                type="submit" 
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl shadow-md transition duration-150 ease-in-out disabled:opacity-50"
                disabled={status !== 'CHATTING' || !messageInput.trim()}
              >
                Send
              </button>
            </div>
          </form>
        )}
      </div>
    );
  };

  // --- Main Layout ---
  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-8 font-sans antialiased">
      <script src="https://cdn.tailwindcss.com"></script>
      <div className="max-w-3xl mx-auto bg-white p-6 sm:p-10 rounded-3xl shadow-2xl border-t-4 border-blue-600">
        <h1 className="text-4xl font-extrabold text-gray-900 mb-2 text-center">
          Anonymous Match Chat
        </h1>
        <p className="text-lg text-gray-500 mb-8 text-center">
          Click below to instantly connect with a random user. Your identity remains anonymous.
        </p>

        {/* User ID Display (Mandatory for multi-user apps) */}
        <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-sm break-words">
          <p className="font-medium text-indigo-700">
            <span className="font-bold">Your Unique ID:</span> {userId || 'Authenticating...'}
          </p>
        </div>

        {/* Status Button Area */}
        {renderStatusButton()}

        {/* Error Message */}
        {errorMessage && (
          <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-xl transition duration-300">
            <strong>Error:</strong> {errorMessage}
          </div>
        )}

        {/* Chat Window */}
        {status !== 'IDLE' && (
            <div className='h-[60vh] mt-6'>
                {renderChatWindow()}
            </div>
        )}
        
      </div>
    </div>
  );
};

export default App;