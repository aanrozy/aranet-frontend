'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import ReCAPTCHA from 'react-google-recaptcha';
import { authAPI } from '../lib/api';
import { auth } from '../lib/auth';
import Modal from './Modal';

export default function LoginModal({ isOpen, onClose, onSwitchToRegister }) {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const recaptchaRef = useRef(null);
  const router = useRouter();

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const token = await recaptchaRef.current.executeAsync();
      recaptchaRef.current.reset();

      const response = await authAPI.login({
        ...formData,
        recaptchaToken: token
      });
      const { token: authToken, user } = response.data;
      
      auth.setAuth(authToken, user);
      onClose();
      router.refresh();
    } catch (error) {
      setError(error.response?.data?.error || 'Login gagal');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({ email: '', password: '' });
    setError('');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Masuk ke Aranet">
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error && (
          <div className="bg-red-900 border border-red-700 text-red-300 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-white mb-1">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={formData.email}
            onChange={handleChange}
            className="appearance-none block w-full px-3 py-2 border border-[#333] rounded-md bg-[#1e1e1e] text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            placeholder="Masukkan email Anda"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-white mb-1">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={formData.password}
            onChange={handleChange}
            className="appearance-none block w-full px-3 py-2 border border-[#333] rounded-md bg-[#1e1e1e] text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            placeholder="Masukkan password Anda"
          />
        </div>

        <ReCAPTCHA
          sitekey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}
          size="invisible"
          ref={recaptchaRef}
        />

        <div className="flex flex-col space-y-3">
          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Memproses...' : 'Masuk'}
          </button>
          
          <div className="text-center">
            <span className="text-sm text-[#b3b3b3]">
              Belum punya akun?{' '}
              <button
                type="button"
                onClick={onSwitchToRegister}
                className="font-medium text-blue-400 hover:text-blue-300"
              >
                Daftar di sini
              </button>
            </span>
          </div>
        </div>
      </form>
    </Modal>
  );
}

