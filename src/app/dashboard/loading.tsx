export default function DashboardLoading() {
  return (
    <div className="animate-pulse px-5 py-6 sm:px-8 sm:py-8">
      <div className="h-7 w-52 rounded-md bg-surface-2" />
      <div className="mt-3 h-4 w-80 rounded bg-surface-2/70" />

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-[108px] rounded-panel border border-line bg-surface" />
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="h-[380px] rounded-card border border-line bg-surface" />
        <div className="h-[380px] rounded-card border border-line bg-surface" />
      </div>
    </div>
  );
}
