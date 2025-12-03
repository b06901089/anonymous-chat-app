import React from 'react';

const StatusButton = ({ status, onJoin, onLeave, isAuthReady }) => {
  const baseClass = "w-full font-bold py-3 px-4 rounded-xl shadow-lg transition duration-150 ease-in-out";

  switch (status) {
    case 'IDLE':
      return (
        <button 
          onClick={onJoin} 
          disabled={!isAuthReady || status === 'JOINING'}
          className={`${baseClass} bg-green-600 hover:bg-green-700 text-white disabled:opacity-50`}
        >
          {status === 'JOINING' ? 'Searching...' : 'Join Anonymous Chat'}
        </button>
      );
    case 'JOINING':
      return (
        <button disabled className={`${baseClass} bg-blue-500 text-white opacity-70 cursor-not-allowed`}>
          Matching...
        </button>
      );
    case 'WAITING':
      return (
        <button onClick={onLeave} className={`${baseClass} bg-yellow-500 hover:bg-yellow-600 text-gray-900`}>
          Waiting for a Partner... (Click to Cancel)
        </button>
      );
    case 'CHATTING':
      return (
        <button onClick={onLeave} className={`${baseClass} bg-red-600 hover:bg-red-700 text-white`}>
          End Chat
        </button>
      );
    case 'ENDED':
      return (
        <button onClick={() => onLeave()} className={`${baseClass} bg-gray-500 hover:bg-gray-600 text-white`}>
          Chat Ended. Start New Chat
        </button>
      );
    default:
      return null;
  }
};

export default StatusButton;