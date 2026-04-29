export async function runOptimisticMutation<TSnapshot, TResult>({
  snapshot,
  applyOptimistic,
  commit,
  rollback,
  onSuccess,
  onError,
}: {
  snapshot: TSnapshot;
  applyOptimistic: () => void;
  commit: () => Promise<TResult>;
  rollback: (snapshot: TSnapshot) => void;
  onSuccess?: (result: TResult) => void;
  onError?: (error: unknown) => void;
}) {
  applyOptimistic();
  try {
    const result = await commit();
    onSuccess?.(result);
    return result;
  } catch (error) {
    rollback(snapshot);
    onError?.(error);
    throw error;
  }
}
