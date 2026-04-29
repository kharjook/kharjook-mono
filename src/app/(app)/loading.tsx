export default function AppLoading() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="h-24 rounded-3xl bg-white/5" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-24 rounded-2xl bg-white/5" />
        <div className="h-24 rounded-2xl bg-white/5" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="h-20 rounded-2xl bg-white/5" />
        <div className="h-20 rounded-2xl bg-white/5" />
      </div>
      <div className="h-44 rounded-3xl bg-white/5" />
    </div>
  );
}
