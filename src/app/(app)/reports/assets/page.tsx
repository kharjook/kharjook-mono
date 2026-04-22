import { Suspense } from 'react';
import { AssetsReportView } from '@/features/reports/components/AssetsReportView';

export default function AssetsReportPage() {
  return (
    <Suspense>
      <AssetsReportView />
    </Suspense>
  );
}
