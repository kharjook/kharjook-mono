'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/shared/lib/supabase/client';

const MIN_PASSWORD_LENGTH = 6; // Supabase default. Bump only if project policy changes.

const useRegisterView = () => {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`رمز عبور باید حداقل ${MIN_PASSWORD_LENGTH} کاراکتر باشد.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('تکرار رمز عبور مطابقت ندارد.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signUpError) {
      console.error(signUpError);
      setError(mapSignUpError(signUpError.message));
      setIsSubmitting(false);
      return;
    }

    // When email confirmation is disabled in Supabase, signUp returns an
    // active session and the user is already logged in. When it's enabled,
    // session is null — degrade gracefully by bouncing back to /login.
    if (data.session) {
      router.replace('/');
      router.refresh();
    } else {
      router.replace('/login?registered=1');
    }
  };

  return {
    email,
    setEmail,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    error,
    setError,
    handleRegister,
    isSubmitting,
  };
};

// Supabase returns English messages; map the common ones to Persian without
// swallowing unknowns (preserve the raw text so debugging stays possible).
function mapSignUpError(raw: string): string {
  const msg = raw.toLowerCase();
  if (msg.includes('already registered') || msg.includes('already exists')) {
    return 'این ایمیل قبلاً ثبت شده است.';
  }
  if (msg.includes('invalid email')) {
    return 'ایمیل وارد شده معتبر نیست.';
  }
  if (msg.includes('password')) {
    return 'رمز عبور معتبر نیست.';
  }
  return raw;
}

export default useRegisterView;
