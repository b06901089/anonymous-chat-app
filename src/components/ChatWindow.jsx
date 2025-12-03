import React, { useState, useEffect, useRef } from 'react';

const ChatWindow = ({ messages, userId, partnerId, status, onSendMessage }) => {
  const [input, setInput] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSendMessage(input);
    setInput('');
  };

  if (status !== 'CHATTING' && status !== 'ENDED' && status !== 'WAITING') return null;

  return (
    <div className="flex flex-col h-full bg-white border border-gray-200 rounded-xl shadow-inner mt-6">
      {/* Header */}
      <div className="p-4 border-b bg-gray-50 rounded-t-xl">
        {status === 'CHATTING' ? (
          <p className="text-lg font-semibold text-gray-800">
            Chatting with: <span className="text-blue-600">{partnerId ? partnerId.substring(0, 8) + '...' : '...'}</span>
          </p>
        ) : (
          <p className="text-lg font-semibold text-gray-500">
             {status === 'WAITING' ? 'Please wait...' : 'History'}
          </p>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3">
        {messages.map((msg, index) => {
          const isMe = msg.senderId === userId;
          const isSys = msg.senderId === 'SYSTEM';
          return (
            <div key={index} className={`flex ${isMe ? 'justify-end' : isSys ? 'justify-center' : 'justify-start'}`}>
              <div className={`max-w-xs px-4 py-2 rounded-xl shadow-md ${
                isMe ? 'bg-blue-500 text-white rounded-br-none' 
                : isSys ? 'bg-yellow-100 text-gray-700 text-center italic'
                : 'bg-gray-200 text-gray-800 rounded-tl-none'
              }`}>
                {!isSys && <div className="text-xs opacity-75 mb-1 font-semibold">{isMe ? 'You' : 'Partner'}</div>}
                {msg.text}
                <div className="text-xs mt-1 text-right opacity-50">
                  {msg.timestamp?.toDate ? msg.timestamp.toDate().toLocaleTimeString() : ''}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* Input */}
      {status === 'CHATTING' && (
        <form onSubmit={handleSubmit} className="p-4 border-t bg-gray-50 rounded-b-xl">
          <div className="flex space-x-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type..."
              className="flex-1 border border-gray-300 p-3 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <button type="submit" disabled={!input.trim()} className="bg-blue-600 text-white font-semibold py-3 px-6 rounded-xl disabled:opacity-50">
              Send
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default ChatWindow;