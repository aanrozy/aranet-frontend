'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '../../lib/auth';
import { conversationsAPI, usersAPI } from '../../lib/api';
import socketService from '../../lib/socket';

const markdownImageRegex = /\[.*?\]\((.*?)\)/i;

export default function ChatPage() {
  const [user, setUser] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [users, setUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState(null);
  const router = useRouter();

  const toggleMenu = (id) => {
    setOpenMenuId(openMenuId === id ? null : id);
  };

  const handleDeleteChat = (conversationId) => {
    setConversationToDelete(conversationId);
    setShowDeleteModal(true);
    setOpenMenuId(null);
  };

  const handleDeleteConfirm = async (deleteType) => {
    if (!conversationToDelete) return;

    try {
      // Use socket service to delete conversation
      socketService.deleteConversation(conversationToDelete, deleteType);
      
      // Remove from local state immediately for better UX
      setConversations(prevConversations => 
        prevConversations.filter(conv => conv._id !== conversationToDelete)
      );
      
    } catch (error) {
      console.error("Error deleting conversation:", error);
      alert('Gagal menghapus percakapan');
    }
    
    setShowDeleteModal(false);
    setConversationToDelete(null);
  };

  const handleDeleteCancel = () => {
    setShowDeleteModal(false);
    setConversationToDelete(null);
  };

  useEffect(() => {
    // Check authentication
    if (typeof window !== 'undefined' && !auth.isAuthenticated()) {
      router.push('/');
      return;
    }

    const currentUser = auth.getUser();
    setUser(currentUser);

    // Connect to socket
    socketService.connect();

    // Load conversations
    loadConversations();

    // Set up socket event listener for new messages to update conversation list
    const handleNewMessageForList = (message) => {
      // Find the conversation related to the new message
      const conversationId = message.conversation;
      setConversations(prevConversations => {
        const existingIndex = prevConversations.findIndex(conv => conv._id === conversationId);
        if (existingIndex > -1) {
          // Update existing conversation
          const updatedConversations = [...prevConversations];
          const conversationToUpdate = { ...updatedConversations[existingIndex] };
          conversationToUpdate.lastMessage = { text: message.text }; // Simplified for display
          conversationToUpdate.lastActivity = message.createdAt;
          updatedConversations.splice(existingIndex, 1);
          updatedConversations.unshift(conversationToUpdate);
          return updatedConversations;
        } else {
          // If conversation not found, reload all conversations to fetch it
          loadConversations();
          return prevConversations;
        }
      });
    };
    
    // Set up socket event listener for conversation updates
    const handleConversationUpdate = async (updatedConversation) => {
      // Find the index of the updated conversation
      const existingIndex = conversations.findIndex(conv => conv._id === updatedConversation.conversationId);

      if (existingIndex > -1) {
        // If conversation exists, update it and move to top
        const updatedConversations = [...conversations];
        const conversationToUpdate = updatedConversations[existingIndex];
        
        // Update lastMessage and lastActivity
        conversationToUpdate.lastMessage = updatedConversation.lastMessage;
        conversationToUpdate.lastActivity = updatedConversation.lastActivity;

        // Remove from current position and add to the beginning
        updatedConversations.splice(existingIndex, 1);
        updatedConversations.unshift(conversationToUpdate);
        setConversations(updatedConversations);
      } else {
        // If new conversation, reload all conversations to fetch it
        loadConversations();
      }
    };
    
    socketService.onNewMessage(handleNewMessageForList);
    socketService.on('conversationUpdate', handleConversationUpdate);
    socketService.on('conversationCreated', handleConversationUpdate);
    
    // Handle conversation deletion
    const handleConversationDeleted = ({ conversationId: deletedConversationId }) => {
      setConversations(prevConversations => 
        prevConversations.filter(conv => conv._id !== deletedConversationId)
      );
    };
    socketService.on("conversationDeleted", handleConversationDeleted);

    return () => {
      socketService.disconnect();
      socketService.off('newMessage', handleNewMessageForList);
      socketService.off('conversationUpdate', handleConversationUpdate);
      socketService.off('conversationCreated', handleConversationUpdate);
      socketService.off("conversationDeleted", handleConversationDeleted);
    };
  }, [router]);

  const loadConversations = async () => {
    try {
      const response = await conversationsAPI.getConversations();
      // Sort conversations by lastActivity (most recent first)
      const sortedConversations = response.data.conversations.sort((a, b) => {
        const dateA = new Date(a.lastActivity || a.createdAt);
        const dateB = new Date(b.lastActivity || b.createdAt);
        return dateB - dateA; // Descending order (newest first)
      });
      setConversations(sortedConversations);
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  const searchUsers = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setUsers([]);
      return;
    }

    try {
      const response = await usersAPI.getUsers(searchQuery);
      setUsers(response.data.users);
    } catch (error) {
      console.error('Error searching users:', error);
    }
  };

  const startConversation = async (userId) => {
    try {
      const response = await conversationsAPI.getOrCreateConversation(userId);
      const conversation = response.data.conversation;
      
      // Update conversation list immediately
      await loadConversations();
      
      // Navigate to chat
      router.push(`/chat/${conversation._id}`);
    } catch (error) {
      console.error('Error starting conversation:', error);
    }
  };

  const handleLogout = () => {
    socketService.disconnect();
    auth.clearAuth();
    router.push('/');
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#111] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="mt-4 text-[#b3b3b3]">Memuat...</p>
        </div>
      </div>
    );
  }

  const displayItems = users.length > 0 ? users.map(searchUser => ({
    id: searchUser._id,
    name: searchUser.username,
    description: searchUser.email,
    isOnline: searchUser.isOnline,
    onClick: () => startConversation(searchUser._id)
  })) : conversations.map(conversation => {
    let desc = conversation.lastMessage?.text || 'Belum ada pesan';
    if (typeof desc === 'string' && markdownImageRegex.test(desc.trim())) {
      desc = 'image';
    }
  
    return {
      id: conversation._id,
      name: conversation.participant.username,
      description: desc,
      time: conversation.lastActivity ? formatTime(conversation.lastActivity) : '',
      isOnline: conversation.participant.isOnline,
      onClick: () => router.push(`/chat/${conversation._id}`),
      isConversation: true
    };
  });
  

  return (
    <div className="max-w-2xl mx-auto p-4 flex flex-col h-screen bg-[#111] text-white font-sans relative">
      <div className="flex justify-between items-start mb-1">
        <div>
          <h1 className="text-xl font-semibold">Welcome to Aranet</h1>
          <p className="text-sm text-[#b3b3b3] mb-5">Direct Messages</p>
        </div>
        <button
          onClick={() => router.push('/')}
          className="text-sm text-blue-400 hover:text-blue-300 hover:underline"
        >
          Anonymous
        </button>
      </div>

      <form onSubmit={searchUsers} className="flex flex-col sm:flex-row items-center gap-2">
        <input
          type="text"
          placeholder="Cari username atau email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full sm:flex-grow px-3 py-1.5 rounded-full bg-[#1e1e1e] text-white placeholder-gray-400 border border-[#333] outline-none text-sm transition focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          className="w-full sm:w-auto px-4 py-1.5 rounded-full bg-[#2d2d2d] text-white text-sm disabled:opacity-50 transition hover:bg-[#3a3a3a]"
        >
          Cari
        </button>
      </form>

      <div className="border-t border-[#333333] my-4" />

      <h2 className="text-sm text-[#b3b3b3] mb-3">{users.length > 0 ? 'Hasil pencarian' : 'Chat list'}</h2>
      
      <ul>
        {displayItems.length === 0 && users.length === 0 && (
          <li className="text-[#8b8b8b] py-3">
            {searchQuery ? 'Tidak ada pengguna ditemukan.' : 'Belum ada percakapan.'}
          </li>
        )}
        {displayItems.map((item) => (
          <li key={item.id} className="flex items-center justify-between mb-5 relative cursor-pointer" onClick={item.onClick}>
            <div className="flex-grow">
              <div
                className="font-medium text-white text-base hover:underline"
              >
                {item.name}
                {item.isOnline && (
                  <span className="ml-2 w-2 h-2 bg-green-400 rounded-full inline-block"></span>
                )}
              </div>
              <div className="text-sm text-[#8b8b8b]">
                {item.description}
              </div>
              {item.time && (
                <div className="text-sm text-[#8b8b8b]">
                  {item.time}
                </div>
              )}
            </div>

            {item.isConversation && (
              <div className="relative z-10" onClick={(e) => e.stopPropagation()}> {/* Prevent click from propagating to parent li */}
                <button
                  onClick={() => toggleMenu(item.id)}
                  className="ml-4 text-white text-lg font-bold focus:outline-none"
                >
                  🗑️
                </button>
                {openMenuId === item.id && (
                  <div className="absolute right-0 mt-2 w-48 bg-[#2d2d2d] rounded-md shadow-lg z-10">
                    <button
                      onClick={() => handleDeleteChat(item.id)}
                      className="block w-full text-left px-4 py-2 text-sm text-white hover:bg-[#3a3a3a]"
                    >
                      Hapus Chat
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="absolute bottom-4 right-4">
        <button
          onClick={handleLogout}
          className="text-[#8b8b8b] hover:text-white text-sm"
        >
          Keluar
        </button>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <>
          {/* Modal Backdrop */}
          <div 
            className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center"
            onClick={handleDeleteCancel}
          >
            {/* Modal Content */}
            <div 
              className="bg-[#2d2d2d] rounded-lg shadow-xl max-w-sm w-full mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h3 className="text-lg font-semibold text-white mb-4">
                  Hapus Percakapan
                </h3>
                <p className="text-gray-300 mb-6">
                  Pilih opsi penghapusan percakapan:
                </p>
                
                <div className="space-y-3">
                  <button
                    onClick={() => handleDeleteConfirm("forMe")}
                    className="w-full text-left px-4 py-3 rounded-lg border border-gray-600 hover:bg-gray-700 transition-colors"
                  >
                    <div className="font-medium text-white">Hapus untuk saya</div>
                    <div className="text-sm text-gray-400">Percakapan akan dihapus hanya untuk Anda</div>
                  </button>
                </div>
                
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={handleDeleteCancel}
                    className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                  >
                    Batal
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

