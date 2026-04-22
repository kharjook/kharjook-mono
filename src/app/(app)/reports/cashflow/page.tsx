import { Suspense } from 'react';
import { CashflowReportView } from '@/features/reports/components/CashflowReportView';

export default function CashflowReportPage() {
  // `useSearchParams` requires a Suspense boundary during SSR in App Router.
  return (
    <Suspense>
      <CashflowReportView />
    </Suspense>
  );
}
