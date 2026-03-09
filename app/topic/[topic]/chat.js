'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';

const CLOUDINARY_UPLOAD_PRESET = 'aranet';
const CLOUDINARY_CLOUD_NAME = 'dnugrqyha';
const CLOUDINARY_FOLDER = 'aranet';
const CLOUDINARY_API_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

const urlRegex = /\b((https?:\/\/|www\.)[^\s]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/[^\s]*)?)/g;
const imageRegex = /\[image\]\((https?:\/\/[^\s]+)\)/g;
const mentionRegex = /@([\w\d-_]+)/g;

const socket = io(`${process.env.NEXT_PUBLIC_API_BASE_URL}/anonymous`);

function sanitizeTopicName(topic) {
  return topic
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

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
  
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  
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

export default function Chat({ initialTopic }) {
  const topic = initialTopic;
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [username, setUsername] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [mentionedUsers, setMentionedUsers] = useState([]);
  const [challenge, setChallenge] = useState(null);
  const [challengeAnswer, setChallengeAnswer] = useState('');
  const [isChallengeOpen, setIsChallengeOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [showMobileActions, setShowMobileActions] = useState(null);
  const [longPressTimer, setLongPressTimer] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  
  const API = process.env.NEXT_PUBLIC_API_BASE_URL;
  const userList = useMemo(() => Array.from(new Set(messages.map(m => m.username))), [messages]);

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
    const savedName = localStorage.getItem('aranet_username');
    if (savedName) setUsername(savedName);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!topic) return;

    const fetchMessages = async () => {
      try {
        const res = await fetch(`${API}/chat/${topic}`);
        const data = await res.json();
        setMessages(data.messages || []);
      } catch (error) {
        console.error(error);
      }
    };

    fetchMessages();
    socket.emit('joinTopic', topic);

    const handleMessage = (message) => {
      setMessages(prev => {
        const isExisting = prev.some(m => 
          m.id === message.id || (m.isOptimistic && m.text === message.text && m.username === message.username)
        );
        return isExisting ? prev : [...prev, message];
      });
    };

    socket.on('message', handleMessage);
    return () => socket.off('message', handleMessage);
  }, [topic, API]);

  const handleFileSelect = useCallback((e) => {
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
  }, []);

  const removeSelectedFile = useCallback((index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const uploadFilesAndSendMessage = useCallback(async () => {
    if ((selectedFiles.length === 0 && !input.trim()) || !username.trim()) return;
    
    setIsUploading(true);
    
    try {
      let messageText = input;
      const sanitizedTopic = sanitizeTopicName(topic);
      
      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
        formData.append('folder', `${CLOUDINARY_FOLDER}/${sanitizedTopic}`);
        
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

      const tempMessage = {
        id: `temp-${Date.now()}`,
        username,
        text: messageText.trim(),
        time: new Date().toISOString(),
        isOptimistic: true,
        repliedToMessageId: replyingTo?.id || null,
        repliedToMessage: replyingTo || null,
      };

      setMessages(prev => [...prev, tempMessage]);
      
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);

      socket.emit('newMessage', {
        topic,
        username,
        text: messageText.trim(),
        userID: localStorage.getItem('userID'),
        repliedToMessageId: replyingTo?.id || null,
      });
      
      setInput('');
      setSelectedFiles([]);
      setReplyingTo(null);
      setShowSuggestions(false);
      setMentionQuery('');
      setSuggestions([]);
      setMentionedUsers([]);
      setSelectedSuggestionIndex(0);
    } catch (error) {
      console.error('Upload error:', error);
      setMessages(prev => prev.filter(m => !m.isOptimistic));
      alert('Gagal mengupload gambar');
    } finally {
      setIsUploading(false);
    }
  }, [input, selectedFiles, username, topic, replyingTo]);

  const handleInputChange = useCallback(e => {
    const val = e.target.value;
    setInput(val);

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
  }, [userList]);

  const selectSuggestion = useCallback(uname => {
    if (!inputRef.current) return;
    const cursorPos = inputRef.current.selectionStart;
    const pre = input.slice(0, cursorPos);
    const post = input.slice(cursorPos);
    const newPre = pre.replace(/@[\w\d-_]*$/, `@${uname} `);
    setInput(newPre + post);
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
  }, [input]);

  const handleKeyDown = useCallback(e => {
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
            handleTrySend();
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
      handleTrySend();
    }
  }, [showSuggestions, suggestions, selectedSuggestionIndex, selectSuggestion]);

  const generateChallenge = useCallback(() => {
    const isMath = Math.random() < 0.5;
    if (isMath) {
      const a = Math.floor(Math.random() * 10);
      const b = Math.floor(Math.random() * 10);
      setChallenge({
        type: 'math',
        question: `${a} + ${b}`,
        expected: (a + b).toString()
      });
    } else {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let rand = '';
      for (let i = 0; i < 6; i++) {
        rand += chars[Math.floor(Math.random() * chars.length)];
      }
      setChallenge({
        type: 'text',
        question: `Type this: ${rand}`,
        expected: rand
      });
    }
    setChallengeAnswer('');
    setIsChallengeOpen(true);
  }, []);

  const handleTrySend = useCallback(() => {
    if ((!input.trim() && selectedFiles.length === 0) || !username.trim()) return;
    generateChallenge();
  }, [input, selectedFiles, username, generateChallenge]);

  const verifyChallengeAndSend = useCallback(() => {
    if (challengeAnswer.trim() === challenge?.expected) {
      setIsChallengeOpen(false);
      uploadFilesAndSendMessage();
    } else {
      alert('Incorrect answer. Try again!');
    }
  }, [challengeAnswer, challenge, uploadFilesAndSendMessage]);

  const handleUsernameSubmit = useCallback(e => {
    e.preventDefault();
    const uname = e.target.username.value.trim();
    if (uname) {
      localStorage.setItem('aranet_username', uname);
      setUsername(uname);
    }
  }, []);

  // Mobile interaction handlers
  const handleTouchStart = useCallback((msg) => {
    // Only show actions for messages from others
    if (username && msg.username !== username) {
      const timer = setTimeout(() => {
        setShowMobileActions(msg.id);
      }, 500); // 500ms long press
      setLongPressTimer(timer);
    }
  }, [username]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  }, [longPressTimer]);

  const handleReplyMobile = useCallback((msg) => {
    setReplyingTo(msg);
    setShowMobileActions(null);
    inputRef.current?.focus();
  }, []);

  const closeMobileActions = useCallback(() => {
    setShowMobileActions(null);
  }, []);

  return (
    <div className="w-full max-w-2xl mx-auto p-4 flex flex-col h-screen bg-[#111] text-white font-sans relative overflow-hidden">
      {!username && (
        <div className="mb-4 flex-shrink-0">
          <form onSubmit={handleUsernameSubmit} className="flex items-center border border-gray-600 rounded-full px-4 py-2 bg-[#1c1c1c]">
            <input name="username" placeholder="Your name..." className="flex-grow bg-transparent text-white placeholder-gray-500 focus:outline-none" maxLength={12} autoComplete="off" spellCheck={false} required/>
            <button type="submit" className="ml-2 p-2 rounded-full bg-[#2a2a2a] text-white hover:bg-[#3a3a3a] transition">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14m0 0l7-7m-7 7l-7-7" />
              </svg>
            </button>
          </form>
        </div>
      )}

      <div className="mb-2 flex-shrink-0">
        <h1 className="text-lg font-bold truncate">{topic}</h1>
        {username && <p className="text-sm text-gray-400 truncate">@{username}</p>}
      </div>

      <div className="flex-grow overflow-y-auto overflow-x-hidden space-y-2 mb-2 min-h-0">
        {messages.map(msg => {
          const isSelf = username && msg.username === username;
          const isImageOnly = isImageOnlyMessage(msg.text);
          
          return (
            <div key={msg.id || msg.time} className={`flex flex-col ${isSelf ? "items-end" : "items-start"} w-full`}>
              {!isSelf && (
                <div className="text-xs font-semibold mb-1 truncate max-w-full" style={{ color: hashColor(msg.username) }}>
                  {msg.username}
                  {msg.tripcode && <span className="text-gray-400 text-[10px] ml-1">· {msg.tripcode}</span>}
                </div>
              )}
              
              <div 
                className={`
                  ${!isImageOnly ? 
                    (isSelf ? 
                      "bg-[#e5e5ea] text-black rounded-t-lg rounded-l-lg p-2" : 
                      "bg-[#2e2e2e] text-white rounded-t-lg rounded-r-lg p-2") : 
                    ""} 
                    max-w-[min(240px,calc(100vw-6rem))] break-words text-sm relative group overflow-hidden
                `}
                onTouchStart={() => handleTouchStart(msg)}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
              >
                {/* Replied message preview */}
                {msg.repliedToMessage && (
                  <div className="mb-2 p-2 bg-black/20 rounded border-l-2 border-blue-500">
                    <div className="text-xs text-gray-400 mb-1">
                      Replying to {msg.repliedToMessage.username}
                    </div>
                    <div className="text-xs text-gray-300 truncate">
                      {msg.repliedToMessage.text.length > 50 
                        ? msg.repliedToMessage.text.substring(0, 50) + '...' 
                        : msg.repliedToMessage.text}
                    </div>
                  </div>
                )}
                
                <div>{parseMessage(msg.text)}</div>
                
                {/* Desktop Reply button */}
                {username && !isSelf && (
                  <button
                    onClick={() => setReplyingTo(msg)}
                    className="absolute -right-8 top-1/2 transform -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-600 hover:bg-gray-500 rounded-full p-1 hidden md:block"
                    title="Reply"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M3 10h10a8 8 0 018 8v2M3 10l6 6M3 10l6-6"/>
                    </svg>
                  </button>
                )}
              </div>
              
              <div className="text-[10px] text-gray-400 text-right mt-1">
                {new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} className="h-px" />
      </div>

      <div className="relative">
        {/* Reply preview */}
        {replyingTo && (
          <div className="mb-2 p-2 bg-[#1c1c1c] rounded-lg border border-gray-600 flex items-center justify-between">
            <div className="flex-1">
              <div className="text-xs text-blue-400 mb-1">
                Replying to {replyingTo.username}
              </div>
              <div className="text-xs text-gray-300 truncate">
                {replyingTo.text.length > 60 
                  ? replyingTo.text.substring(0, 60) + '...' 
                  : replyingTo.text}
              </div>
            </div>
            <button
              onClick={() => setReplyingTo(null)}
              className="ml-2 text-gray-400 hover:text-white"
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
          <div className="mb-2 p-2 bg-[#1c1c1c] rounded-lg border border-gray-600">
            {selectedFiles.map((file, index) => (
              <div key={index} className="flex items-center justify-between py-1 px-2">
                <span className="text-sm truncate max-w-xs">{file.name}</span>
                <button
                  onClick={() => removeSelectedFile(index)}
                  className="ml-2 text-gray-400 hover:text-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center border border-gray-600 rounded-full px-2 py-2 bg-[#1c1c1c]">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!username || isUploading}
            className="p-2 rounded-full text-gray-400 hover:text-white hover:bg-[#3a3a3a] disabled:opacity-50 transition-colors"
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
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            className="flex-grow bg-transparent text-white placeholder-gray-500 focus:outline-none"
            disabled={!username}
            autoComplete="off"
            spellCheck="false"
          />
          
          <button
            onClick={handleTrySend}
            disabled={(!input.trim() && selectedFiles.length === 0) || !username.trim() || isUploading}
            className="ml-2 p-2 rounded-full bg-[#2a2a2a] text-white hover:bg-[#3a3a3a] disabled:opacity-50 transition-colors"
          >
            {isUploading ? (
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

      {isChallengeOpen && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#1c1c1c] border border-gray-600 rounded-lg p-6 max-w-sm w-full">
            <h2 className="text-white text-lg font-semibold mb-4">Challenge</h2>
            <p className="text-gray-300 mb-4">{challenge?.question}</p>
            <input
              type="text"
              value={challengeAnswer}
              onChange={(e) => setChallengeAnswer(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && verifyChallengeAndSend()}
              className="w-full px-3 py-2 rounded bg-[#2a2a2a] border border-gray-500 text-white mb-4"
              autoFocus
            />
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setIsChallengeOpen(false)}
                className="px-4 py-2 rounded bg-gray-600 text-white hover:bg-gray-500"
              >
                Cancel
              </button>
              <button
                onClick={verifyChallengeAndSend}
                className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-500"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Mobile Actions Modal */}
      {showMobileActions && (
        <div className="fixed inset-x-0 bottom-0 bg-black/50 backdrop-blur-sm flex items-end justify-center z-50 md:hidden">
          <div className="bg-[#1c1c1c] border border-gray-600 rounded-t-lg p-4 w-full max-w-sm mx-auto animate-slide-up">
            <div className="text-white text-sm mb-4 text-center">
              Message from {messages.find(m => m.id === showMobileActions)?.username}
            </div>
            <div className="space-y-2">
              <button
                onClick={() => handleReplyMobile(messages.find(m => m.id === showMobileActions))}
                className="w-full text-left p-3 rounded bg-[#2a2a2a] hover:bg-[#3a3a3a] text-white flex items-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M3 10h10a8 8 0 018 8v2M3 10l6 6M3 10l6-6"/>
                </svg>
                Reply
              </button>
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={closeMobileActions}
                className="px-4 py-2 rounded bg-gray-600 text-white hover:bg-gray-500"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}