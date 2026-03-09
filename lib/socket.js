import { io } from 'socket.io-client';
import { auth } from './auth';

class SocketService {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // Start with 1 second
  }

  connect() {
    const token = auth.getToken();
    if (!token) {
      console.error('No auth token found');
      return;
    }

    const serverUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
    
    this.socket = io(`${serverUrl}/dm`, {
      auth: {
        token: token
      },
      transports: ['websocket', 'polling'],
      timeout: 20000, // 20 seconds connection timeout
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: this.reconnectDelay,
      reconnectionDelayMax: 5000,
      maxReconnectionAttempts: this.maxReconnectAttempts,
      randomizationFactor: 0.5,
      forceNew: false,
      upgrade: true
    });

    this.socket.on('connect', () => {
      console.log('Connected to server');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000; // Reset delay
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Disconnected from server:', reason);
      this.isConnected = false;
      
      // Handle different disconnect reasons
      if (reason === 'io server disconnect') {
        // Server initiated disconnect, try to reconnect
        this.handleReconnection();
      } else if (reason === 'transport close' || reason === 'transport error') {
        // Network issues, try to reconnect
        this.handleReconnection();
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      this.isConnected = false;
      
      if (error.message === 'Authentication error') {
        auth.clearAuth();
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      } else {
        this.handleReconnection();
      }
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log('Reconnected after', attemptNumber, 'attempts');
      this.isConnected = true;
      this.reconnectAttempts = 0;
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('Reconnection error:', error);
      this.reconnectAttempts++;
    });

    this.socket.on('reconnect_failed', () => {
      console.error('Failed to reconnect after maximum attempts');
      this.isConnected = false;
    });

    return this.socket;
  }

  handleReconnection() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 5000);
      
      console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        if (!this.isConnected && this.socket) {
          this.socket.connect();
        }
      }, delay);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.reconnectAttempts = 0;
    }
  }

  // Join a conversation room
  joinConversation(conversationId) {
    if (this.socket) {
      this.socket.emit('joinConversation', conversationId);
    }
  }

  // Send a message
  sendMessage(conversationId, text, repliedToMessageId = null, forwardedFromMessageId = null, forwardedFromConversationId = null) {
    if (this.socket) {
      this.socket.emit('sendMessage', { 
        conversationId, 
        text, 
        repliedToMessageId,
        forwardedFromMessageId,
        forwardedFromConversationId
      });
    }
  }

  // Send typing indicator
  sendTyping(conversationId, isTyping) {
    if (this.socket) {
      this.socket.emit('typing', { conversationId, isTyping });
    }
  }

  // Delete message
  deleteMessage(messageId, deleteType = 'forEveryone') {
    if (this.socket) {
      this.socket.emit('deleteMessage', { messageId, deleteType });
    }
  }

  // Delete conversation
  deleteConversation(conversationId, deleteType = 'forMe') {
    if (this.socket) {
      this.socket.emit('deleteConversation', { conversationId, deleteType });
    }
  }

  // Confirm message delivery
  confirmMessageDelivery(messageId) {
    if (this.socket) {
      this.socket.emit('messageDelivered', { messageId });
    }
  }

  // Event listeners
  onNewMessage(callback) {
    if (this.socket) {
      this.socket.on('newMessage', callback);
    }
  }

  onUserTyping(callback) {
    if (this.socket) {
      this.socket.on('userTyping', callback);
    }
  }

  onUserOnline(callback) {
    if (this.socket) {
      this.socket.on('userOnline', callback);
    }
  }

  onUserOffline(callback) {
    if (this.socket) {
      this.socket.on('userOffline', callback);
    }
  }

  onError(callback) {
    if (this.socket) {
      this.socket.on('error', callback);
    }
  }

  // Generic event listener method
  on(event, callback) {
    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  // Remove event listeners
  off(event, callback) {
    if (this.socket) {
      this.socket.off(event, callback);
    }
  }

  getSocket() {
    return this.socket;
  }
}

// Create singleton instance
const socketService = new SocketService();
export default socketService;

