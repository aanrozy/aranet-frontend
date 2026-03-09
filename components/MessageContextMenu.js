'use client';

import { useState, useEffect } from 'react';

const MessageContextMenu = ({ 
  isVisible, 
  position, 
  message, 
  onClose, 
  onReply, 
  onForward, 
  onCopy, 
  onStar, 
  onInfo, 
  onDelete,
  currentUser 
}) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    if (isVisible) {
      setIsAnimating(true);
    } else {
      const timer = setTimeout(() => setIsAnimating(false), 200);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  const handleAction = (action) => {
    action();
    onClose();
  };

  const copyToClipboard = () => {
    if (message?.text) {
      navigator.clipboard.writeText(message.text);
      handleAction(onCopy || (() => {}));
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = (deleteType) => {
    setShowDeleteModal(false);
    onDelete(message, deleteType);
    onClose();
  };

  const handleDeleteCancel = () => {
    setShowDeleteModal(false);
  };

  if (!isAnimating && !isVisible) return null;

  const menuItems = [
    {
      id: 'star',
      label: 'Star',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
        </svg>
      ),
      action: () => handleAction(onStar || (() => {})),
      show: true
    },
    {
      id: 'reply',
      label: 'Reply',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 10h10a8 8 0 018 8v2M3 10l6 6M3 10l6-6"/>
        </svg>
      ),
      action: () => handleAction(() => onReply(message)),
      show: message?.sender?._id !== currentUser?._id
    },
    {
      id: 'forward',
      label: 'Forward',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6-6M21 10l-6 6"/>
        </svg>
      ),
      action: () => handleAction(() => onForward(message)),
      show: true
    },
    {
      id: 'copy',
      label: 'Copy',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>
      ),
      action: copyToClipboard,
      show: true
    },
    {
      id: 'info',
      label: 'Info',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
      ),
      action: () => handleAction(() => onInfo(message)),
      show: true
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="3,6 5,6 21,6"/>
          <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6"/>
          <line x1="10" y1="11" x2="10" y2="17"/>
          <line x1="14" y1="11" x2="14" y2="17"/>
        </svg>
      ),
      action: handleDeleteClick,
      show: true, // Show delete for all users (both sender and receiver)
      isDestructive: true
    }
  ];

  const visibleItems = menuItems.filter(item => item.show);

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 z-40 transition-opacity duration-200 ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}
      />
      
      {/* Context Menu */}
      <div
        className={`fixed z-50 bg-gray-100 rounded-2xl shadow-2xl min-w-[200px] transition-all duration-200 transform ${
          isVisible 
            ? 'opacity-100 scale-100 translate-y-0' 
            : 'opacity-0 scale-95 translate-y-2'
        }`}
        style={{
          left: Math.min(position.x, window.innerWidth - 220),
          top: Math.max(10, Math.min(position.y, window.innerHeight - (visibleItems.length * 56) - 20)),
        }}
      >
        {/* Message preview */}
        <div className="px-4 py-3 border-b border-gray-200 bg-green-100 rounded-t-2xl">
          <div className="text-sm text-gray-800 font-medium truncate">
            {message?.sender?.username || 'Unknown'}
          </div>
          <div className="text-xs text-gray-600 mt-1 line-clamp-2">
            {message?.text?.length > 60 
              ? message.text.substring(0, 60) + '...' 
              : message?.text || 'No content'}
          </div>
        </div>

        {/* Menu items */}
        <div className="py-2">
          {visibleItems.map((item, index) => (
            <button
              key={item.id}
              onClick={item.action}
              className={`w-full flex items-center px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                item.isDestructive ? 'text-red-600' : 'text-gray-800'
              } ${index === visibleItems.length - 1 ? 'rounded-b-2xl' : ''}`}
            >
              <div className="flex items-center justify-center w-6 h-6 mr-3">
                {item.icon}
              </div>
              <span className="text-base font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <>
          {/* Modal Backdrop */}
          <div 
            className="fixed inset-0 z-60 bg-black bg-opacity-50 flex items-center justify-center"
            onClick={handleDeleteCancel}
          >
            {/* Modal Content */}
            <div 
              className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Hapus Pesan
                </h3>
                <p className="text-gray-600 mb-6">
                  Pilih opsi penghapusan pesan:
                </p>
                
                <div className="space-y-3">
                  <button
                    onClick={() => handleDeleteConfirm('forMe')}
                    className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                  >
                    <div className="font-medium text-gray-900">Hapus untuk saya</div>
                    <div className="text-sm text-gray-500">Pesan akan dihapus hanya untuk Anda</div>
                  </button>
                  
                  {message?.sender?._id === currentUser?._id && (
                    <button
                      onClick={() => handleDeleteConfirm('forEveryone')}
                      className="w-full text-left px-4 py-3 rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
                    >
                      <div className="font-medium text-red-600">Hapus untuk semua orang</div>
                      <div className="text-sm text-red-400">Pesan akan dihapus untuk semua peserta</div>
                    </button>
                  )}
                </div>
                
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={handleDeleteCancel}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    Batal
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default MessageContextMenu;

