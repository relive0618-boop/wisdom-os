export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f4f1ea] p-8 font-sans text-[#20221f]">
      <main className="flex w-full max-w-2xl flex-col items-center gap-8 text-center">
        <div className="flex items-center gap-4">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#20221f] font-serif text-2xl text-white">
            谋
          </div>
          <div className="text-left">
            <strong className="text-lg">AI Wisdom OS</strong>
            <span className="block text-sm text-[#77786f]">智慧决策引擎</span>
          </div>
        </div>

        <h1 className="font-serif text-4xl leading-tight tracking-tight">
          先算清局势，
          <br />
          再决定是否出手。
        </h1>

        <p className="max-w-lg leading-relaxed text-[#77786f]">
          以《孙子兵法》十三篇为知识骨架，结合现实目标、资源、限制与风险，生成三种可执行策略。
        </p>

        <div className="mt-4 flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-[#486451]" />
          <span className="text-sm text-[#77786f]">本地智慧引擎 · 零 API 费用可运行</span>
        </div>

        <div className="mt-8 flex gap-4">
          <a
            href="/decision"
            className="rounded-xl bg-[#8a4d2e] px-6 py-3 font-bold text-white hover:bg-[#b46d43]"
          >
            开始一次决策分析
          </a>
          <a
            href="/knowledge"
            className="rounded-xl border border-[#ded8cc] bg-white/80 px-6 py-3 font-bold hover:bg-white"
          >
            浏览知识库
          </a>
        </div>
      </main>
    </div>
  );
}
