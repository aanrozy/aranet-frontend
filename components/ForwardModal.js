'use client';

import { useState, useEffect } from 'react';
import { usersAPI, conversationsAPI } from '../lib/api';

const ForwardModal = ({ 
  isVisible, 
  message, 
  conversationId,
  onClose, 
  onForward 
}) => {
  const [users, setUsers] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [additionalText, setAdditionalText] = useState('');

  useEffect(() => {
    if (isVisible) {
      loadUsers();
    } else {
      // Reset state when modal closes
      setSelectedUsers([]);
      setSearchQuery('');
      setAdditionalText('');
    }
  }, [isVisible]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const response = await usersAPI.getUsers();
      setUsers(response.data.users);
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoading(false);
    }
  };

  const searchUsers = async (query) => {
    if (!query.trim()) {
      loadUsers();
      return;
    }

    setLoading(true);
    try {
      const response = await usersAPI.getUsers(query);
      setUsers(response.data.users);
    } catch (error) {
      console.error('Error searching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchChange = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    
    // Debounce search
    const timeoutId = setTimeout(() => {
      searchUsers(query);
    }, 300);

    return () => clearTimeout(timeoutId);
  };

  const toggleUserSelection = (user) => {
    setSelectedUsers(prev => {
      const isSelected = prev.some(u => u._id === user._id);
      if (isSelected) {
        return prev.filter(u => u._id !== user._id);
      } else {
        return [...prev, user];
      }
    });
  };

  const handleForward = async () => {
    if (selectedUsers.length === 0 || !message) return;

    setForwarding(true);
    try {
      const targetUserIds = selectedUsers.map(user => user._id);
      await conversationsAPI.forwardMessage(
        conversationId, 
        message._id, 
        targetUserIds, 
        additionalText.trim() || undefined
      );
      
      onForward && onForward(selectedUsers);
      onClose();
    } catch (error) {
      console.error('Error forwarding message:', error);
      alert('Failed to forward message');
    } finally {
      setForwarding(false);
    }
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Forward Message</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Message Preview */}
        <div className="px-6 py-3 bg-green-50 border-b border-gray-200">
          <div className="text-sm text-gray-600 mb-1">Forwarding message:</div>
          <div className="text-sm text-gray-800 bg-white rounded-lg p-2 border">
            {message?.text?.length > 100 
              ? message.text.substring(0, 100) + '...' 
              : message?.text || 'No content'}
          </div>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-gray-200">
          <input
            type="text"
            placeholder="Search users..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>

        {/* Selected Users */}
        {selectedUsers.length > 0 && (
          <div className="px-6 py-3 border-b border-gray-200 bg-blue-50">
            <div className="text-sm text-gray-600 mb-2">
              Selected ({selectedUsers.length}):
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedUsers.map(user => (
                <div
                  key={user._id}
                  className="flex items-center bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm"
                >
                  <span className="truncate max-w-[100px]">{user.username}</span>
                  <button
                    onClick={() => toggleUserSelection(user)}
                    className="ml-2 text-blue-600 hover:text-blue-800"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Users List */}
        <div className="flex-1 overflow-y-auto max-h-64">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {searchQuery ? 'No users found' : 'No users available'}
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {users.map(user => {
                const isSelected = selectedUsers.some(u => u._id === user._id);
                return (
                  <button
                    key={user._id}
                    onClick={() => toggleUserSelection(user)}
                    className={`w-full flex items-center px-6 py-3 text-left hover:bg-gray-50 transition-colors ${
                      isSelected ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-center flex-1 min-w-0">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-medium mr-3 ${
                        isSelected ? 'bg-blue-500' : 'bg-gray-400'
                      }`}>
                        {user.username.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {user.username}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {user.email}
                        </div>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="text-blue-500 ml-2">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Additional Text */}
        <div className="px-6 py-3 border-t border-gray-200">
          <textarea
            placeholder="Add a message (optional)..."
            value={additionalText}
            onChange={(e) => setAdditionalText(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            rows={2}
            maxLength={500}
          />
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-gray-50 flex justify-end space-x-3">
          <button
            onClick={onClose}
            disabled={forwarding}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleForward}
            disabled={selectedUsers.length === 0 || forwarding}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {forwarding ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Forwarding...
              </>
            ) : (
              `Forward${selectedUsers.length > 0 ? ` (${selectedUsers.length})` : ''}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ForwardModal;

