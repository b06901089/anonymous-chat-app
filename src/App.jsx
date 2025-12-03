import React from 'react';
import { useAnonymousChat } from './hooks/useAnonymousChat';
import StatusButton from './components/StatusButton';
import ChatWindow from './components/ChatWindow';

const App = () => {
  // Use the hook to get all logic and state
  const { 
    userId, status, messages, partnerId, errorMessage, isAuthReady,
    joinChat, leaveChat, sendMessage 
  } = useAnonymousChat();

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-8 font-sans antialiased">
      <script src="https://cdn.tailwindcss.com"></script>
      
      <div className="max-w-3xl mx-auto bg-white p-6 sm:p-10 rounded-3xl shadow-2xl border-t-4 border-blue-600">
        <h1 className="text-4xl font-extrabold text-gray-900 mb-2 text-center">
          Anonymous Match Chat
        </h1>
        <p className="text-lg text-gray-500 mb-8 text-center">
          Click below to instantly connect with a random user.
        </p>

        {/* ID Display */}
        <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-sm break-words">
          <p className="font-medium text-indigo-700">
            <span className="font-bold">ID:</span> {userId || 'Authenticating...'}
          </p>
        </div>

        {/* Control Button */}
        <StatusButton 
          status={status} 
          isAuthReady={isAuthReady} 
          onJoin={joinChat} 
          onLeave={leaveChat} 
        />

        {/* Errors */}
        {errorMessage && (
          <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-xl">
            <strong>Error:</strong> {errorMessage}
          </div>
        )}

        {/* Chat Area */}
        {status !== 'IDLE' && (
          <div className='h-[60vh] mt-6'>
            <ChatWindow 
              messages={messages} 
              userId={userId} 
              partnerId={partnerId} 
              status={status} 
              onSendMessage={sendMessage}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;