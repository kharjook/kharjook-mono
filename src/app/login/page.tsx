import { Suspense } from 'react';
import { LoginView } from '@/features/auth/components/LoginView/LoginView';

export default function LoginPage() {
  // Suspense boundary is required because LoginView consumes useSearchParams;
  // without it Next bails the whole page out of static rendering.
  return (
    <Suspense fallback={null}>
      <LoginView />
    </Suspense>
  );
}
