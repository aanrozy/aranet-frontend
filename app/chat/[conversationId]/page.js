'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { conversationsAPI } from '../../../lib/api';
import socketService from '../../../lib/socket';
import MessageContextMenu from '../../../components/MessageContextMenu';
import ForwardModal from '../../../components/ForwardModal';

const CLOUDINARY_UPLOAD_PRESET = 'aranet';
const CLOUDINARY_CLOUD_NAME = 'dnugrqyha';
const CLOUDINARY_FOLDER = 'aranet';
const CLOUDINARY_API_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

const urlRegex = /\b((https?:\/\/|www\.)[^\s]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/[^\s]*)?)/g;
const imageRegex = /\[image\]\((https?:\/\/[^\s]+)\)/g;
const mentionRegex = /@([\w\d-_]+)/g;

function hashColor(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = input.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${hash % 360}, 60%, 50%)`;
}

function isImageOnlyMessage(text) {
  return /^(\s*\[image\]\(https?:\/\/[^\s]+\)\s*)+$/.test(text);
}

function parseMessage(text) {
  const parts = [];
  let lastIndex = 0;
  
  if (typeof text === 'string') {
    text.replace(imageRegex, (match, url, offset) => {
      if (offset > lastIndex) parts.push(text.slice(lastIndex, offset));
      parts.push(
        <div key={offset}>
          <img 
            src={url} 
            alt="Uploaded content" 
            className="max-w-[150px] max-h-[100px] rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = 'https://via.placeholder.com/200x150?text=Image+Error';
            }}
            onClick={(e) => {
              e.stopPropagation();
              document.dispatchEvent(new CustomEvent('showFullscreenImage', { detail: url }));
            }}
          />
        </div>
      );
      lastIndex = offset + match.length;
    });
  } else {
    console.warn('Expected "text" to be a string but got:', text);
  }
  
  
  if (typeof text === 'string') {
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }
  } else {
    console.warn('Expected "text" to be a string but got:', text);
  }
  
  
  return parts.flatMap((part, idx) => {
    if (typeof part !== 'string') return part;
    
    const urlParts = [];
    let urlLastIndex = 0;
    part.replace(urlRegex, (match, _, __, offset) => {
      if (offset > urlLastIndex) urlParts.push(part.slice(urlLastIndex, offset));
      const url = match.startsWith('www.') ? `https://${match}` : 
                  match.startsWith('http') ? match : `https://${match}`;
      urlParts.push(
        <a key={offset} href={url} target="_blank" rel="noopener noreferrer" className="underline text-blue-500">
          {match}
        </a>
      );
      urlLastIndex = offset + match.length;
    });
    
    if (urlLastIndex < part.length) urlParts.push(part.slice(urlLastIndex));
    
    return urlParts.flatMap((urlPart, urlIdx) => {
      if (typeof urlPart !== 'string') return urlPart;
      
      const segs = [];
      let last = 0;
      
      urlPart.replace(mentionRegex, (m, uname, off) => {
        if (off > last) segs.push(urlPart.slice(last, off));
        segs.push(
          <span key={`${idx}-${urlIdx}-${off}`} className="text-blue-600 font-semibold">
            @{uname}
          </span>
        );
        last = off + m.length;
      });
      
      if (last < urlPart.length) segs.push(urlPart.slice(last));
      return segs;
    });
  });
}

export default function ChatPage() {
  const [user, setUser] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [mentionedUsers, setMentionedUsers] = useState([]);
  const [replyingTo, setReplyingTo] = useState(null);
  const [forwardingMessage, setForwardingMessage] = useState(null);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [showMobileActions, setShowMobileActions] = useState(null);
  const [longPressTimer, setLongPressTimer] = useState(null);
  const [contextMenu, setContextMenu] = useState({
    isVisible: false,
    position: { x: 0, y: 0 },
    message: null
  });
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const router = useRouter();
  const params = useParams();
  const conversationId = params.conversationId;

  // Get user list from messages for mentions
  const userList = Array.from(new Set(messages.map(m => m.sender?.username).filter(Boolean)));

  useEffect(() => {
    const handleFullscreenImage = (e) => {
      setFullscreenImage(e.detail);
    };

    document.addEventListener('showFullscreenImage', handleFullscreenImage);
    return () => {
      document.removeEventListener('showFullscreenImage', handleFullscreenImage);
    };
  }, []);

  useEffect(() => {
    // Check authentication
    if (!auth.isAuthenticated()) {
      router.push('/login');
      return;
    }

    const currentUser = auth.getUser();
    setUser(currentUser);

    // Connect to socket if not connected
    if (!socketService.isConnected) {
      socketService.connect();
    }

    // Load conversation and messages
    loadConversation();
    loadMessages();

    // Join conversation room
    socketService.joinConversation(conversationId);

    // Set up socket event listeners
    const handleNewMessage = (message) => {
      // Only add message if it belongs to the currently active conversation
      if (message.conversation === conversationId) {
        setMessages(prev => [...prev, message]);
        scrollToBottom();
      } else {
        // Optionally, trigger a notification or update the conversation list
        console.log(`New message for conversation ${message.conversation}, but current conversation is ${conversationId}`);
        // Here you would typically update a global state for unread messages or trigger a toast notification
      }
    };

    const handleUserTyping = ({ conversationId: typingConversationId, userId, username, isTyping }) => {
      if (typingConversationId === conversationId && userId !== currentUser._id) {
        setTypingUsers(prev => {
          if (isTyping) {
            return prev.includes(username) ? prev : [...prev, username];
          } else {
            return prev.filter(name => name !== username);
          }
        });
      }
    };

    const handleError = (error) => {
      console.error('Socket error:', error);
      alert(error.message || 'Terjadi kesalahan');
    };

    const handleMessageDeleted = ({ messageId, conversationId: deletedConversationId, deletedBy }) => {
      // Only handle if it's for the current conversation
      if (deletedConversationId === conversationId) {
        setMessages(prev => prev.filter(msg => msg._id !== messageId));
      }
    };

    socketService.onNewMessage(handleNewMessage);
    socketService.onUserTyping(handleUserTyping);
    socketService.onError(handleError);
    socketService.on('messageDeleted', handleMessageDeleted);

    const handleConversationDeleted = ({ conversationId: deletedConversationId }) => {
      if (deletedConversationId === conversationId) {
        router.push("/chat");
      }
    };
    
    socketService.on("conversationDeleted", handleConversationDeleted);

    return () => {
      socketService.off('newMessage', handleNewMessage);
      socketService.off('userTyping', handleUserTyping);
      socketService.off('error', handleError);
      socketService.off('messageDeleted', handleMessageDeleted);
      socketService.off("conversationDeleted", handleConversationDeleted);
      
      // Clear typing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [conversationId, router]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadConversation = async () => {
    try {
      // Load conversations for forward modal
      const response = await conversationsAPI.getConversations();
      setConversations(response.data.conversations);
    } catch (error) {
      console.error('Error loading conversation:', error);
    }
  };

  const handleReply = (message) => {
    setReplyingTo(message);
    setContextMenu({ isVisible: false, position: { x: 0, y: 0 }, message: null });
    inputRef.current?.focus();
  };

  const handleForward = (message) => {
    setForwardingMessage(message);
    setShowForwardModal(true);
    setContextMenu({ isVisible: false, position: { x: 0, y: 0 }, message: null });
  };

  const handleInfo = (message) => {
    // Show message info like WhatsApp
    const messageDate = new Date(message.createdAt);
    const formattedDate = messageDate.toLocaleDateString('id-ID', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const formattedTime = messageDate.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    const infoText = `Pengirim: ${message.sender?.username || 'Unknown'}\nTanggal: ${formattedDate}\nWaktu: ${formattedTime}\nPesan: ${message.text || 'No content'}`;
    
    alert(infoText);
    setContextMenu({ isVisible: false, position: { x: 0, y: 0 }, message: null });
  };

  const handleDelete = async (message, deleteType) => {
    try {
      // Emit delete message event to backend with deleteType
      socketService.deleteMessage(message._id, deleteType);
      
      if (deleteType === 'forEveryone') {
        // Remove message from local state immediately for better UX
        setMessages(prev => prev.filter(msg => msg._id !== message._id));
      } else if (deleteType === 'forMe') {
        // For 'forMe', also remove from local state since user won't see it anymore
        setMessages(prev => prev.filter(msg => msg._id !== message._id));
      }
        
    } catch (error) {
      console.error('Error deleting message:', error);
      alert('Gagal menghapus pesan');
      // Reload messages to restore state if delete failed
      loadMessages();
    }
    setContextMenu({ isVisible: false, position: { x: 0, y: 0 }, message: null });
  };

  const handleForwardSuccess = (forwardedUsers) => {
    alert(`Message forwarded to ${forwardedUsers.length} user(s)`);
  };

  const forwardMessage = async (targetConversationId) => {
    if (!forwardingMessage) return;

    try {
      socketService.sendMessage(targetConversationId, forwardingMessage.text, null, forwardingMessage._id, conversationId);
      setShowForwardModal(false);
      setForwardingMessage(null);
      alert('Pesan berhasil diteruskan');
    } catch (error) {
      console.error('Error forwarding message:', error);
      alert('Gagal meneruskan pesan');
    }
  };

  // Context menu handlers
  const showContextMenu = (e, message) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Add null check for currentTarget
    if (!e.currentTarget) {
      console.warn('showContextMenu: currentTarget is null');
      return;
    }
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX || (rect.left + rect.width / 2);
    const y = e.clientY || (rect.top + rect.height / 2);
    
    setContextMenu({
      isVisible: true,
      position: { x, y },
      message
    });
  };

  const hideContextMenu = () => {
    setContextMenu({ isVisible: false, position: { x: 0, y: 0 }, message: null });
  };

  // Mobile interaction handlers
  const handleTouchStart = useCallback((message, e) => {
    const timer = setTimeout(() => {
      const touch = e.touches[0];
      if (touch && e.currentTarget) {
        showContextMenu({
          preventDefault: () => {},
          stopPropagation: () => {},
          clientX: touch.clientX,
          clientY: touch.clientY,
          currentTarget: e.currentTarget
        }, message);
      }
    }, 500); // 500ms long press
    setLongPressTimer(timer);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  }, [longPressTimer]);



  const loadMessages = async () => {
    try {
      const response = await conversationsAPI.getMessages(conversationId);
      setMessages(response.data.messages);
    } catch (error) {
      console.error('Error loading messages:', error);
      if (error.response?.status === 404) {
        console.warn('Conversation not found, redirecting to chat list');
        router.push('/chat');
      } else if (error.response?.status === 401) {
        console.warn('Unauthorized, redirecting to login');
        router.push('/login');
      } else {
        // For other errors, show empty state but don't redirect
        console.warn('Failed to load messages, showing empty state');
        setMessages([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files).filter(file => {
      if (!file.type.match('image.*')) {
        alert(`File ${file.name} bukan gambar dan akan diabaikan`);
        return false;
      }
      if (file.size > 5 * 1024 * 1024) {
        alert(`File ${file.name} melebihi ukuran maksimal 5MB dan akan diabaikan`);
        return false;
      }
      return true;
    });
    
    setSelectedFiles(prev => [...prev, ...files]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeSelectedFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const uploadFilesAndSendMessage = async () => {
    if ((selectedFiles.length === 0 && !newMessage.trim()) || sending) return;

    setSending(true);
    setIsUploading(true);
    let messageText = newMessage.trim();

    try {
      // Upload files to Cloudinary
      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
        formData.append('folder', `${CLOUDINARY_FOLDER}/${conversationId}`);
        
        const response = await fetch(CLOUDINARY_API_URL, {
          method: 'POST',
          body: formData
        });
        
        const data = await response.json();
        if (data.secure_url) {
          messageText += ` [image](${data.secure_url}) `;
        } else {
          throw new Error('Upload gagal');
        }
      }

      setNewMessage('');
      setSelectedFiles([]);

      // Stop typing indicator
      if (isTyping) {
        socketService.sendTyping(conversationId, false);
        setIsTyping(false);
      }

      socketService.sendMessage(conversationId, messageText, replyingTo?._id);
      setReplyingTo(null);
    } catch (error) {
      console.error('Error sending message:', error);
      setNewMessage(messageText); // Restore message on error
      alert('Gagal mengirim pesan');
    } finally {
      setSending(false);
      setIsUploading(false);
    }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setNewMessage(val);

    const mentioned = Array.from(new Set(val.match(/@([\w\d-_]+)/g)?.map(m => m.slice(1)) || []));
    setMentionedUsers(mentioned);

    const cursorPos = e.target.selectionStart;
    const pre = val.slice(0, cursorPos);
    const match = pre.match(/@([\w\d-_]*)$/);
    
    if (match) {
      const q = match[1];
      setMentionQuery(q);
      const filtered = userList
        .filter(u => u.toLowerCase().startsWith(q.toLowerCase()))
        .filter(u => !mentioned.includes(u));
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
      setSelectedSuggestionIndex(0);
    } else {
      setShowSuggestions(false);
      setMentionQuery('');
      setSuggestions([]);
    }

    // Handle typing indicator
    if (!isTyping && val.trim()) {
      setIsTyping(true);
      socketService.sendTyping(conversationId, true);
    }

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set new timeout to stop typing indicator
    typingTimeoutRef.current = setTimeout(() => {
      if (isTyping) {
        setIsTyping(false);
        socketService.sendTyping(conversationId, false);
      }
    }, 2000);
  };

  const selectSuggestion = (uname) => {
    if (!inputRef.current) return;
    const cursorPos = inputRef.current.selectionStart;
    const pre = newMessage.slice(0, cursorPos);
    const post = newMessage.slice(cursorPos);
    const newPre = pre.replace(/@[\w\d-_]*$/, `@${uname} `);
    setNewMessage(newPre + post);
    setMentionedUsers(prev => [...prev, uname]);
    setShowSuggestions(false);
    setMentionQuery('');
    setSuggestions([]);
    
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.selectionStart = inputRef.current.selectionEnd = newPre.length;
      }
    }, 0);
  };

  const handleKeyDown = (e) => {
    if (showSuggestions) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedSuggestionIndex(prev => (prev + 1) % suggestions.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
          break;
        case 'Enter':
          e.preventDefault();
          if (suggestions.length > 0) {
            selectSuggestion(suggestions[selectedSuggestionIndex]);
          } else {
            handleSendMessage(e);
          }
          break;
        case 'Escape':
          setShowSuggestions(false);
          break;
        default:
          break;
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    uploadFilesAndSendMessage();
  };

  const formatMessageTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Mobile interaction handlers




  const handleReplyMobile = useCallback((message) => {
    setReplyingTo(message);
    setShowMobileActions(null);
    inputRef.current?.focus();
  }, []);

  const handleForwardMobile = useCallback((message) => {
    setForwardingMessage(message);
    setShowMobileActions(null);
    setShowForwardModal(true);
  }, []);

  const closeMobileActions = useCallback(() => {
    setShowMobileActions(null);
  }, []);

  // const handleDeleteConversation = async () => {
  //   if (confirm('Apakah Anda yakin ingin menghapus percakapan ini?')) {
  //     try {
  //       await conversationsAPI.deleteConversation(conversationId);
  //       socketService.getSocket().emit("conversationDeleted", { conversationId });
  //       router.push('/chat');
  //     } catch (error) {
  //       console.error("Error deleting conversation:", error);
  //       alert('Gagal menghapus percakapan');
  //     }
  //   }
  // };

  if (loading) {
    return (
      <div className="loader-container">
        <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="loader">
          <path pathLength="360" d="M 56.3752 2 H 7.6248 C 7.2797 2 6.9999 2.268 6.9999 2.5985 V 61.4015 C 6.9999 61.7321 7.2797 62 7.6248 62 H 56.3752 C 56.7203 62 57.0001 61.7321 57.0001 61.4015 V 2.5985 C 57.0001 2.268 56.7203 2 56.3752 2 Z"></path>
          <path pathLength="360" d="M 55.7503 60.803 H 8.2497 V 3.1971 H 55.7503 V 60.803 Z"></path>
          <path pathLength="360" d="M 29.7638 47.6092 C 29.4971 47.3997 29.1031 47.4368 28.8844 47.6925 C 28.6656 47.9481 28.7046 48.3253 28.9715 48.5348 L 32.8768 51.6023 C 32.9931 51.6936 33.1333 51.738 33.2727 51.738 C 33.4533 51.738 33.6328 51.6634 33.7562 51.519 C 33.975 51.2634 33.936 50.8862 33.6692 50.6767 L 29.7638 47.6092 Z"></path>
          <path pathLength="360" d="M 42.3557 34.9046 C 38.4615 34.7664 36.9617 37.6749 36.7179 39.2213 L 35.8587 44.2341 C 35.8029 44.5604 36.0335 44.8681 36.374 44.9218 C 36.4084 44.9272 36.4424 44.9299 36.476 44.9299 C 36.7766 44.9299 37.0415 44.7214 37.0918 44.4281 L 37.9523 39.4076 C 37.9744 39.2673 38.544 35.9737 42.311 36.1007 C 42.6526 36.1124 42.9454 35.8544 42.9577 35.524 C 42.9702 35.1937 42.7006 34.9164 42.3557 34.9046 Z"></path>
          <path pathLength="360" d="M 13.1528 55.5663 C 13.1528 55.8968 13.4326 56.1648 13.7777 56.1648 H 50.2223 C 50.5674 56.1648 50.8472 55.8968 50.8472 55.5663 V 8.4339 C 50.8472 8.1034 50.5674 7.8354 50.2223 7.8354 H 13.7777 C 13.4326 7.8354 13.1528 8.1034 13.1528 8.4339 V 55.5663 Z"></path>
          <path pathLength="360" d="M 25.3121 26.5567 C 24.9717 27.4941 25.0042 28.8167 25.0634 29.5927 C 23.6244 29.8484 20.3838 31.0913 18.9478 37.0352 C 18.5089 37.5603 17.8746 38.1205 17.2053 38.7114 C 16.2598 39.546 15.2351 40.4515 14.4027 41.5332 V 20.5393 H 23.7222 C 23.7178 22.6817 24.1666 25.4398 25.3121 26.5567 Z"></path>
          <path pathLength="360" d="M 49.5975 43.4819 C 48.3838 39.1715 46.3138 33.6788 43.4709 29.7736 C 42.6161 28.5995 40.7095 27.0268 39.6852 26.1818 L 39.6352 26.1405 C 39.4176 24.783 39.1158 22.5803 38.8461 20.5394 H 49.5976 V 43.4819 Z"></path>
          <path pathLength="360" d="M 29.8161 45.151 C 29.0569 44.7516 28.3216 44.4344 27.6455 44.185 C 27.6488 44.0431 27.6397 43.8917 27.6478 43.7715 C 27.9248 39.7036 30.4491 36.2472 35.1502 33.4979 C 38.7221 31.4091 42.2682 30.5427 42.3036 30.5341 C 42.3563 30.5213 42.416 30.5119 42.4781 30.5037 C 42.6695 30.7681 42.8577 31.0407 43.0425 31.3217 C 42.1523 31.4917 39.6591 32.0721 37.0495 33.6188 C 34.2273 35.2912 30.7775 38.4334 29.9445 44.0105 C 29.9025 44.2924 29.8211 45.0524 29.8161 45.151 Z"></path>
          <path pathLength="360" d="M 32.2021 33.6346 C 29.1519 33.8959 26.6218 32.5634 25.6481 31.4461 C 25.9518 30.3095 28.4436 28.4847 30.2282 27.4911 C 30.436 27.3755 30.5563 27.1556 30.5372 26.9261 L 30.4311 25.6487 C 30.5264 25.6565 30.622 25.6621 30.7181 25.6642 L 30.8857 25.6672 C 32.0645 25.6912 33.2094 25.302 34.1059 24.5658 L 34.112 24.5607 L 34.4024 32.5344 C 33.8302 32.8724 33.2863 33.2227 32.7728 33.5852 C 32.5227 33.6032 32.3068 33.6258 32.2021 33.6346 Z"></path>
          <path pathLength="360" d="M 27.8056 17.9207 C 27.8041 17.9207 27.8025 17.9207 27.8012 17.9207 L 27.0155 17.9259 L 26.8123 15.4718 C 26.8174 15.4609 26.8238 15.4501 26.8282 15.4389 C 27.2218 15.0856 28.158 14.3463 29.1923 14.252 C 31.0985 14.0778 33.442 14.3386 33.8213 16.5565 L 34.0564 23.0299 L 33.2927 23.6566 C 32.6306 24.2004 31.7888 24.4889 30.9118 24.4703 L 30.7437 24.4673 C 29.7977 24.4473 28.8841 24.0555 28.2376 23.3933 C 27.9671 23.1152 27.748 22.7967 27.5871 22.4474 C 27.426 22.0961 27.3292 21.7272 27.2989 21.3494 L 27.1145 19.1223 L 27.8097 19.1178 C 28.1548 19.1154 28.4327 18.8457 28.4303 18.5152 C 28.4278 18.186 28.1487 17.9207 27.8056 17.9207 Z"></path>
          <path pathLength="360" d="M 38.4358 26.5433 C 38.4589 26.6829 38.5326 26.8101 38.6443 26.9026 L 38.8697 27.0889 C 39.5266 27.6307 40.6931 28.5938 41.5811 29.4829 C 40.6409 29.7428 38.2545 30.4762 35.6283 31.8516 L 35.3161 23.281 C 35.316 23.2777 35.3158 23.2743 35.3157 23.271 L 35.0692 16.4785 C 35.0682 16.455 35.0659 16.4316 35.0621 16.4082 C 34.6703 13.9692 32.4875 12.7498 29.0741 13.0603 C 28.5659 13.1067 28.0885 13.255 27.6614 13.4468 C 28.321 12.6324 29.4568 11.8605 31.3984 11.8605 C 32.892 11.8605 34.2086 12.4323 35.3118 13.5599 C 36.3478 14.6187 36.9981 15.9821 37.1923 17.5023 C 37.5097 19.987 38.0932 24.4655 38.4358 26.5433 Z"></path>
          <path pathLength="360" d="M 25.6994 17.1716 L 26.053 21.4425 C 26.094 21.9536 26.225 22.4539 26.4434 22.93 C 26.6613 23.403 26.9574 23.8335 27.3242 24.2106 C 27.833 24.7317 28.4641 25.128 29.1549 25.3746 L 29.2609 26.6526 C 28.8063 26.9219 27.959 27.4459 27.0978 28.0926 C 26.7982 28.3177 26.5261 28.5365 26.2766 28.7503 C 26.2677 27.9385 26.3477 27.0941 26.6128 26.699 C 26.7087 26.5561 26.7368 26.3807 26.6898 26.2168 C 26.6428 26.0528 26.5253 25.9159 26.3667 25.8398 C 25.2812 25.3198 24.639 20.7943 25.134 18.7283 C 25.2757 18.1366 25.4822 17.6126 25.6994 17.1716 Z"></path>
          <path pathLength="360" d="M 14.4025 54.9677 V 43.9616 C 15.1297 42.1745 16.6798 40.8031 18.052 39.5917 C 18.5756 39.1296 19.0771 38.6852 19.5054 38.243 C 20.1455 38.2763 21.8243 38.4721 22.2856 39.611 C 22.526 40.696 22.9861 41.6387 23.6573 42.3985 C 23.7809 42.5383 23.9573 42.6104 24.1347 42.6104 C 24.2773 42.6104 24.4206 42.5639 24.5381 42.4688 C 24.8014 42.2553 24.8343 41.8776 24.6115 41.6252 C 22.2978 39.0062 23.8504 34.5445 23.8663 34.4997 C 23.9782 34.1872 23.8046 33.8471 23.4785 33.7397 C 23.1507 33.6321 22.7964 33.7986 22.6843 34.1111 C 22.6657 34.1631 22.2262 35.4024 22.1149 37.0253 C 22.0992 37.2529 22.0927 37.476 22.0916 37.6958 C 21.4663 37.3478 20.7678 37.1827 20.215 37.1057 C 21.266 32.9598 23.2109 31.5061 24.4867 30.9973 C 24.4164 31.2001 24.3769 31.3974 24.3692 31.5894 C 24.3639 31.7208 24.404 31.8501 24.4831 31.9575 C 25.0708 32.7551 26.1363 33.5207 27.4065 34.0584 C 28.2686 34.4232 29.5576 34.8194 31.1457 34.861 C 28.2499 37.3877 26.6257 40.39 26.4009 43.6936 C 26.3992 43.7195 26.3962 43.7461 26.3928 43.7729 C 25.1023 43.399 24.2167 43.2969 24.1252 43.2873 C 23.9888 43.2728 23.8487 43.3023 23.7304 43.3716 C 23.0495 43.7702 22.591 44.3922 22.4046 45.1703 C 22.2331 45.8868 22.3106 46.6885 22.6019 47.3807 C 22.0046 47.6438 21.3269 47.7784 20.7914 47.848 C 19.4939 45.6912 20.8219 44.6351 20.989 44.5146 C 21.2655 44.3207 21.3274 43.9492 21.1268 43.6822 C 20.9253 43.4139 20.5346 43.3533 20.2546 43.5462 C 19.4539 44.0983 18.406 45.6195 19.3656 47.7888 C 18.685 47.5329 17.6255 46.8145 17.8055 44.832 C 17.8836 43.9718 18.1884 43.3352 18.7117 42.9403 C 19.5815 42.2834 20.8198 42.451 20.8366 42.4537 C 21.1748 42.503 21.4952 42.2819 21.5494 41.9563 C 21.6037 41.6297 21.3713 41.3231 21.0306 41.2712 C 20.9582 41.2599 19.2558 41.0142 17.9494 41.9917 C 17.1375 42.5992 16.6703 43.5199 16.5605 44.7282 C 16.1991 48.7092 19.7376 49.1126 19.7732 49.116 C 19.7951 49.1182 22.2326 49.1079 23.7782 48.1211 C 23.8053 48.1039 24.4158 47.7528 24.4158 47.7528 C 24.5214 47.8841 24.6624 48.0532 24.8294 48.2438 L 22.3598 49.4874 C 22.1544 49.5908 22.0257 49.7949 22.0257 50.0171 V 51.8127 C 22.0257 52.1432 22.3054 52.4112 22.6505 52.4112 S 23.2754 52.1432 23.2754 51.8127 V 50.3786 L 25.6987 49.1582 C 26.021 49.4709 26.3894 49.7985 26.7963 50.1188 L 24.6627 50.7144 C 24.4768 50.7663 24.3269 50.8977 24.2559 51.0702 L 23.3968 53.1651 C 23.2704 53.4729 23.4286 53.8202 23.7498 53.9409 C 23.8248 53.9694 23.9023 53.9825 23.9782 53.9825 C 24.2277 53.9825 24.4632 53.8384 24.5599 53.6028 L 25.307 51.7814 L 28.0879 51.0053 C 28.5412 51.2713 29.0239 51.51 29.5341 51.6979 C 29.6079 51.7252 29.6836 51.738 29.7582 51.738 C 30.0092 51.738 30.246 51.592 30.3415 51.3542 C 30.4653 51.0457 30.3048 50.6994 29.9825 50.5808 C 27.1642 49.5423 25.2952 46.9394 25.2771 46.9138 C 25.1245 46.6979 24.8439 46.6013 24.5831 46.6746 L 23.7537 46.9082 C 23.5672 46.4465 23.5125 45.8992 23.623 45.4377 C 23.7168 45.046 23.9138 44.7341 24.21 44.508 C 25.267 44.6734 29.863 45.5842 33.2732 49.2905 C 33.3967 49.4247 33.569 49.4932 33.7423 49.4932 C 33.889 49.4932 34.0364 49.444 34.1551 49.3437 C 34.414 49.1251 34.439 48.747 34.2108 48.4989 C 33.9947 48.2641 33.7738 48.0421 33.5507 47.8278 L 38.211 47.0175 C 38.3595 47.0014 40.1672 46.8356 41.295 48.2161 C 41.4182 48.3671 41.6019 48.4458 41.7875 48.4458 C 41.9222 48.4458 42.0578 48.4043 42.1721 48.3186 C 42.4439 48.1148 42.4919 47.7386 42.2791 47.4784 C 40.6703 45.5094 38.1379 45.8184 38.0305 45.8327 C 38.0218 45.8339 38.0132 45.8353 38.0043 45.8368 L 32.3855 46.8136 C 31.945 46.4667 31.4998 46.1528 31.0557 45.8697 C 31.0618 45.5534 31.0651 45.1775 31.0836 44.9842 C 31.1138 44.6713 31.1524 44.3635 31.1997 44.0606 C 31.8329 40.0032 34.0061 36.8432 37.6695 34.6587 C 40.6334 32.8915 43.5195 32.4536 43.5682 32.4464 C 43.604 32.4413 43.663 32.4341 43.7302 32.4251 C 47.2229 38.3378 49.3982 46.7588 49.5976 49.5158 V 54.9673 H 14.4025 Z"></path>
          <path pathLength="360" d="M 49.5975 9.0325 V 19.3422 H 38.689 C 38.5937 18.6105 38.5061 17.9301 38.4329 17.3569 C 38.2063 15.5828 37.4422 13.9868 36.2237 12.7413 C 34.8748 11.3624 33.2514 10.6633 31.3984 10.6633 C 27.3688 10.6633 25.8233 13.5309 25.556 15.0901 C 25.1526 15.5932 24.3175 16.7856 23.916 18.46 C 23.8568 18.7069 23.8106 19.0066 23.7778 19.3421 H 14.4025 V 9.0323 H 49.5975 Z"></path>
          <path pathLength="360" d="M 30.2223 21.2875 C 30.5674 21.2875 30.8471 21.0195 30.8471 20.6889 V 18.92 L 31.9916 18.9675 C 32.3376 18.9833 32.628 18.7259 32.643 18.3956 C 32.658 18.0654 32.3907 17.786 32.0459 17.7717 L 30.2495 17.6969 C 30.077 17.6889 29.9133 17.7497 29.7902 17.8624 C 29.6671 17.9753 29.5976 18.1315 29.5976 18.2948 V 20.6889 C 29.5974 21.0195 29.8772 21.2875 30.2223 21.2875 Z"></path>
        </svg>
      </div>
    );
  }

  // Get other participant info from first message
  const otherParticipant = messages.length > 0 
    ? messages.find(msg => msg.sender._id !== user._id)?.sender
    : null;

  return (
    <div className="w-full max-w-2xl mx-auto p-4 flex flex-col h-screen bg-[#111] text-white font-sans relative overflow-hidden">
      {/* Header */}
      <div className="mb-2 flex-shrink-0 flex justify-between items-center">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold truncate">
            {otherParticipant ? `Chat with ${otherParticipant.username}` : 'Chat'}
          </h1>
          {user && <p className="text-sm text-gray-400 truncate">@{user.username}</p>}
        </div>
        <div className="flex items-center space-x-2 ml-4">
          <button
            onClick={() => router.push('/chat')}
            className="text-blue-400 hover:text-blue-300 text-sm"
          >
            Kembali
          </button>
          {/* <button
            onClick={handleDeleteConversation}
            className="text-red-400 hover:text-red-300 text-sm"
            title="Hapus Percakapan"
          >
            🗑️
          </button> */}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-grow overflow-y-auto overflow-x-hidden space-y-2 mb-2 min-h-0">
        {messages.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[#8b8b8b]">Belum ada pesan</p>
            <p className="text-sm text-[#8b8b8b] mt-1">
              Mulai percakapan dengan mengirim pesan pertama
            </p>
          </div>
        ) : (
          messages.map((message) => {
            const isSelf = user && message.sender._id === user._id;
            const isImageOnly = isImageOnlyMessage(message.text);
            
            return (
              <div key={message._id} className={`flex flex-col ${isSelf ? "items-end" : "items-start"} w-full`}>
                {/* {!isSelf && (
                  <div className="text-xs font-semibold mb-1 truncate max-w-full" style={{ color: hashColor(message.sender.username) }}>
                    {message.sender.username}
                  </div>
                )} */}
                
                <div 
                  className={`
                    ${!isImageOnly ? 
                      (isSelf ? 
                        "bg-[#e5e5ea] text-black rounded-t-lg rounded-l-lg p-2" : 
                        "bg-[#2e2e2e] text-white rounded-t-lg rounded-r-lg p-2") : 
                      ""} 
                      max-w-[min(240px,calc(100vw-6rem))] break-words text-sm relative group overflow-hidden cursor-pointer
                  `}
                  onContextMenu={(e) => showContextMenu(e, message)}
                  onTouchStart={(e) => handleTouchStart(message, e)}
                  onTouchEnd={handleTouchEnd}
                  onTouchCancel={handleTouchEnd}
                >
                  {/* Replied message preview */}
                  {message.repliedToMessage && (
                    <div className="mb-2 p-2 bg-black/20 rounded border-l-2 border-blue-500">
                      <div className="text-xs text-gray-400 mb-1">
                        Replying to {message.repliedToMessage?.sender?.username}
                      </div>
                      <div className="text-xs text-gray-300 truncate">
                        {(message.repliedToMessage?.text || "").length > 50 
                          ? (message.repliedToMessage?.text || "").substring(0, 50) + "..." 
                          : (message.repliedToMessage?.text || "")}
                      </div>
                    </div>
                  )}

                  {/* Forwarded message preview */}
                  {message.forwardedFromMessage && (
                    <div className="mb-2 p-2 bg-black/20 rounded border-l-2 border-green-500">
                      <div className="text-xs text-gray-400 mb-1">
                        Forwarded from {message.forwardedFromMessage.sender.username}
                        {message.forwardedFromConversation && (
                          <span> in {message.forwardedFromConversation.name}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-300 truncate">
                        {message.forwardedFromMessage.text.length > 50 
                          ? message.forwardedFromMessage.text.substring(0, 50) + '...' 
                          : message.forwardedFromMessage.text}
                      </div>
                    </div>
                  )}
                  
                  <div className="break-words overflow-hidden">{parseMessage(message.text)}</div>

                  {/* Desktop Action buttons */}
                  {user && (
                    <div className="absolute -right-16 top-1/2 transform -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex space-x-1 md:flex">
                      {!isSelf && (
                        <button
                          onClick={() => handleReply(message)}
                          className="bg-gray-600 hover:bg-gray-500 rounded-full p-1"
                          title="Reply"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="M3 10h10a8 8 0 018 8v2M3 10l6 6M3 10l6-6"/>
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => handleForward(message)}
                        className="bg-gray-600 hover:bg-gray-500 rounded-full p-1"
                        title="Forward"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6-6M21 10l-6 6"/>
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
                
                <div className="text-[10px] text-gray-400 text-right mt-1">
                  {formatMessageTime(message.createdAt)}
                </div>
              </div>
            );
          })
        )}
        
        {/* Typing indicator */}
        {typingUsers.length > 0 && (
          <div className="flex justify-start">
            <div className="bg-[#2e2e2e] text-white rounded-t-lg rounded-r-lg p-2 text-sm">
              {typingUsers.join(', ')} sedang mengetik...
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} className="h-px" />
      </div>

      {/* Input Area */}
      <div className="relative flex-shrink-0 w-full">
        {/* Reply preview */}
        {replyingTo && (
          <div className="mb-2 p-2 bg-[#1c1c1c] rounded-lg border border-gray-600 flex items-center justify-between max-w-full overflow-hidden">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-blue-400 mb-1 truncate">
                Replying to {replyingTo.sender.username}
              </div>
              <div className="text-xs text-gray-300 truncate">
                {replyingTo.text.length > 60 
                  ? replyingTo.text.substring(0, 60) + '...' 
                  : replyingTo.text}
              </div>
            </div>
            <button
              onClick={() => setReplyingTo(null)}
              className="ml-2 text-gray-400 hover:text-white flex-shrink-0"
            >
              ×
            </button>
          </div>
        )}

        {showSuggestions && (
          <ul className="absolute z-10 bg-[#222] border border-gray-600 rounded-md bottom-full mb-2 max-h-40 overflow-auto w-full text-sm">
            {suggestions.map((uname, i) => (
              <li
                key={uname}
                onClick={() => selectSuggestion(uname)}
                className={`px-3 py-1 cursor-pointer ${
                  i === selectedSuggestionIndex ? 'bg-blue-600 text-white' : 'text-gray-300'
                } hover:bg-blue-500 hover:text-white`}
              >
                @{uname}
              </li>
            ))}
          </ul>
        )}

        {selectedFiles.length > 0 && (
          <div className="mb-2 p-2 bg-[#1c1c1c] rounded-lg border border-gray-600 max-w-full overflow-hidden">
            {selectedFiles.map((file, index) => (
              <div key={index} className="flex items-center justify-between py-1 px-2 min-w-0">
                <span className="text-sm truncate flex-1 min-w-0">{file.name}</span>
                <button
                  onClick={() => removeSelectedFile(index)}
                  className="ml-2 text-gray-400 hover:text-white flex-shrink-0"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center border border-gray-600 rounded-full px-2 py-2 bg-[#1c1c1c] w-full max-w-full">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!user || isUploading}
            className="p-2 rounded-full text-gray-400 hover:text-white hover:bg-[#3a3a3a] disabled:opacity-50 transition-colors flex-shrink-0"
            title="Upload image"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept="image/*"
            className="hidden"
            disabled={isUploading}
            multiple
          />

          <input
            ref={inputRef}
            type="text"
            placeholder="Message..."
            value={newMessage}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            className="flex-1 min-w-0 bg-transparent text-white placeholder-gray-500 focus:outline-none"
            disabled={!user}
            autoComplete="off"
            spellCheck="false"
          />
          
          <button
            onClick={handleSendMessage}
            disabled={(!newMessage.trim() && selectedFiles.length === 0) || !user || sending || isUploading}
            className="ml-2 p-2 rounded-full bg-[#2a2a2a] text-white hover:bg-[#3a3a3a] disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {sending || isUploading ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 2v4m0 12v4m6-10h4M2 12h4m13.657-5.657l-2.828 2.828m-9.9 9.9l-2.828 2.828" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5m0 0l-7 7m7-7l7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Fullscreen Image Modal */}
      {fullscreenImage && (
        <div 
          className="fixed inset-0 bg-black/90 backdrop-blur-lg flex items-center justify-center z-50 p-4"
          onClick={() => setFullscreenImage(null)}
        >
          <div className="relative max-w-full max-h-full">
            <button 
              className="absolute -top-4 -right-4 bg-black/70 hover:bg-black/90 rounded-full p-1 z-10 transition"
              onClick={(e) => {
                e.stopPropagation();
                setFullscreenImage(null);
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <img 
              src={fullscreenImage} 
              alt="Fullscreen content" 
              className="max-w-full max-h-[90vh] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {/* Context Menu */}
      <MessageContextMenu
        isVisible={contextMenu.isVisible}
        position={contextMenu.position}
        message={contextMenu.message}
        currentUser={user}
        onClose={hideContextMenu}
        onReply={handleReply}
        onForward={handleForward}
        onCopy={() => {}}
        onStar={() => {}}
        onInfo={handleInfo}
        onDelete={handleDelete}
      />

      {/* Forward Modal */}
      <ForwardModal
        isVisible={showForwardModal}
        message={forwardingMessage}
        conversationId={conversationId}
        onClose={() => {
          setShowForwardModal(false);
          setForwardingMessage(null);
        }}
        onForward={handleForwardSuccess}
      />
    </div>
  );
}





