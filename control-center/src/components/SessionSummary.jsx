export default function SessionSummary({ summaryStats }) {
  if (!summaryStats) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div className="bg-[#fafaf8] border border-[#ececea] rounded-2xl p-5">
        <p className="text-[10px] font-bold tracking-widest text-[#8a8a85] uppercase mb-1">
          Monitored Duration
        </p>
        <p className="text-2xl font-black text-[#111111]">
          {summaryStats.duration}s
        </p>
      </div>

      <div className="bg-[#fafaf8] border border-[#ececea] rounded-2xl p-5">
        <p className="text-[10px] font-bold tracking-widest text-[#8a8a85] uppercase mb-1">
          Monitored Slides
        </p>
        <p className="text-2xl font-black text-[#111111]">
          {summaryStats.totalSlides}
        </p>
      </div>

      <div className="bg-[#fafaf8] border border-[#ececea] rounded-2xl p-5">
        <p className="text-[10px] font-bold tracking-widest text-[#8a8a85] uppercase mb-1">
          Avg Focus
        </p>
        <p className="text-2xl font-black text-[#1f8a3f]">
          {summaryStats.avgAttention}
        </p>
      </div>

      <div className="bg-[#fafaf8] border border-[#ececea] rounded-2xl p-5">
        <p className="text-[10px] font-bold tracking-widest text-[#8a8a85] uppercase mb-1">
          Avg Engagement
        </p>
        <p className="text-2xl font-black text-[#2563eb]">
          {summaryStats.avgEngagement}
        </p>
      </div>
    </div>
  );
}
