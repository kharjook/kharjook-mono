import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { createSupabaseServerClient } from '@/shared/lib/supabase/server';
import { PortfolioProvider } from '@/features/portfolio/PortfolioProvider';
import { Shell } from '@/features/shell/components/Shell';

export default async function AppLayout({
  children,
  modal,
}: {
  children: ReactNode;
  modal: ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <PortfolioProvider initialUser={user}>
      <Shell modal={modal}>{children}</Shell>
    </PortfolioProvider>
  );
}
