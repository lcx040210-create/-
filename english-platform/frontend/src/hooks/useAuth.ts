'use client';
import { useState, useEffect } from 'react';
import { getUser, isLoggedIn, logout } from '@/lib/auth';
import api from '@/lib/api';

export function useAuth() {
  const [user, setUser] = useState(getUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoggedIn()) {
      setLoading(false);
      return;
    }
    api
      .get('/users/me')
      .then(({ data }) => {
        setUser(data);
        localStorage.setItem('user', JSON.stringify(data));
      })
      .catch(() => {
        logout();
      })
      .finally(() => setLoading(false));
  }, []);

  return { user, loading, logout };
}
