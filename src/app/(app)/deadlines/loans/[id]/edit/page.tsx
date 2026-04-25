import { LoanFormView } from '@/features/deadlines/components/LoanFormView';

export default async function EditLoanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LoanFormView loanId={id} />;
}
