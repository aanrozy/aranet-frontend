'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ReCAPTCHA from 'react-google-recaptcha';
import { auth } from '../lib/auth';
import LoginModal from '../components/LoginModal';
import RegisterModal from '../components/RegisterModal';

const safeLocalStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignored
    }
  },
};

export default function Home() {
  const [topics, setTopics] = useState([]);
  const [newTopic, setNewTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const countdownRef = useRef(null);
  const recaptchaRef = useRef(null);
  const router = useRouter();
  const API = process.env.NEXT_PUBLIC_API_BASE_URL;

  const fetchTopics = async () => {
    try {
      const res = await fetch(`${API}/topics`);
      const data = await res.json();
      const validTopics = data.topics
        .filter((t) => t.ttl > 0)
        .map((t) => ({ ...t, fetchTime: Date.now() }));
      setTopics(validTopics);
    } catch (err) {
      console.error(err);
    }
  };

  const formatTTL = (ttl) => {
    const hours = Math.floor(ttl / 3600);
    const minutes = Math.floor((ttl % 3600) / 60);
    const seconds = ttl % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
  };

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Check authentication status
    setIsAuthenticated(auth.isAuthenticated());

    const last = safeLocalStorage.getItem('lastTopicAddTime');
    if (last) {
      const elapsed = Math.floor((Date.now() - parseInt(last, 10)) / 1000);
      const remaining = 60 - elapsed;
      if (remaining > 0) {
        setCountdown(remaining);
      }
    }
    fetchTopics();
  }, []);

  useEffect(() => {
    if (countdown > 0) {
      countdownRef.current = setTimeout(() => setCountdown((c) => c - 1), 1000);
    }
    return () => clearTimeout(countdownRef.current);
  }, [countdown]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newTopic.trim()) return;

    try {
      setLoading(true);
      const token = await recaptchaRef.current.executeAsync();
      recaptchaRef.current.reset();

      const res = await fetch(`${API}/topics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: newTopic.trim(), recaptchaToken: token }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || 'Gagal menambahkan.');
        return;
      }

      setNewTopic('');
      fetchTopics();
      safeLocalStorage.setItem('lastTopicAddTime', Date.now().toString());
      setCountdown(60);
    } catch (err) {
      console.error(err);
      alert('Terjadi kesalahan.');
    } finally {
      setLoading(false);
    }
  };

  const handleAuthButtonClick = () => {
    if (isAuthenticated) {
      // Navigate to direct message page
      router.push('/chat');
    } else {
      // Show login modal
      setShowLoginModal(true);
    }
  };

  const handleLoginSuccess = () => {
    setIsAuthenticated(auth.isAuthenticated());
    setShowLoginModal(false);
    fetchTopics();
  };

  const handleRegisterSuccess = () => {
    setIsAuthenticated(auth.isAuthenticated());
    setShowRegisterModal(false);
    fetchTopics();
  };

  useEffect(() => {
    const authCheckInterval = setInterval(() => {
      setIsAuthenticated(auth.isAuthenticated());
    }, 1000);

    return () => clearInterval(authCheckInterval);
  }, []);

  const switchToRegister = () => {
    setShowLoginModal(false);
    setShowRegisterModal(true);
  };

  const switchToLogin = () => {
    setShowRegisterModal(false);
    setShowLoginModal(true);
  };

  const topicsWithTTL = topics.map((t) => {
    const elapsed = Math.floor((now - t.fetchTime) / 1000);
    const ttlNow = Math.max(t.ttl - elapsed, 0);
    return { ...t, ttl: ttlNow };
  });

  return (
    <div className="max-w-2xl mx-auto p-4 flex flex-col h-screen bg-[#111] text-white font-sans relative">
      <div className="flex justify-between items-start mb-1">
        <div>
          <h1 className="text-xl font-semibold">Welcome to Aranet</h1>
          <p className="text-sm text-[#b3b3b3] mb-5">The true anonymouse chat room</p>
        </div>
        <button
          onClick={handleAuthButtonClick}
          className="text-sm text-blue-400 hover:text-blue-300 hover:underline"
        >
          {isAuthenticated ? 'Chat' : 'Sign in'}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-center gap-2">
        <input
          type="text"
          placeholder="New topic..."
          value={newTopic}
          onChange={(e) => setNewTopic(e.target.value)}
          disabled={loading || countdown > 0}
          className="w-full sm:flex-grow px-3 py-1.5 rounded-full bg-[#1e1e1e] text-white placeholder-gray-400 border border-[#333] outline-none text-sm transition focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading || countdown > 0}
          className="w-full sm:w-auto px-4 py-1.5 rounded-full bg-[#2d2d2d] text-white text-sm disabled:opacity-50 transition hover:bg-[#3a3a3a]"
        >
          {countdown > 0
            ? `${Math.floor(countdown / 60)}m ${countdown % 60}s`
            : 'Create'}
        </button>
      </form>

      <ReCAPTCHA
        sitekey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}
        size="invisible"
        ref={recaptchaRef}
      />

      <div className="border-t border-[#333333] my-4" />

      <h2 className="text-sm text-[#b3b3b3] mb-3">Topic list</h2>
      <ul>
        {topicsWithTTL.length === 0 && (
          <li className="text-[#8b8b8b] py-3">Tidak ada topik.</li>
        )}
        {topicsWithTTL.map((topic) => (
          <li key={topic.name} className="flex items-center justify-between mb-5">
            <div>
              <Link
                href={`/topic/${encodeURIComponent(topic.name)}`}
                className="font-medium text-white text-base hover:underline"
              >
                {topic.name}
              </Link>
              <div className="text-sm text-[#8b8b8b]">
                deleted at {formatTTL(topic.ttl)}
              </div>
            </div>

            <Link
              href={`/topic/${encodeURIComponent(topic.name)}`}
              className="ml-4 bg-[#2d2d2d] text-white text-sm px-4 py-1.5 rounded-full hover:bg-[#3a3a3a]"
            >
              Join
            </Link>
          </li>
        ))}
      </ul>

      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSwitchToRegister={switchToRegister}
      />

      <RegisterModal
        isOpen={showRegisterModal}
        onClose={() => setShowRegisterModal(false)}
        onSwitchToLogin={switchToLogin}
      />
    </div>
  );
}

