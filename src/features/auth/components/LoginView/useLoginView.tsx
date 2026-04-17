'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/shared/lib/supabase/client';

const useLoginView = () => {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setIsSubmitting(true);
    setError('');

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      console.error(signInError);
      setError('شماره موبایل یا رمز عبور اشتباه است.');
      setIsSubmitting(false);
      return;
    }

    router.replace('/');
    router.refresh();
  };

  return {
    email,
    setEmail,
    password,
    setPassword,
    error,
    setError,
    handleLogin,
    isSubmitting,
    setIsSubmitting,
  };
};

export default useLoginView;
