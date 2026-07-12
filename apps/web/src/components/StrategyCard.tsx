"use client";

export function StrategyCard({
  name,
  position,
  actions,
  suitableWhen,
  risk,
  recommended = false,
}: {
  name: string;
  position: string;
  actions: string[];
  suitableWhen: string;
  risk: string;
  recommended?: boolean;
}) {
  return (
    <article
      className={`rounded-xl border p-5 ${
        recommended
          ? "border-[#8a4d2e] shadow-[inset_0_3px_0_#8a4d2e]"
          : "border-[#ded8cc]"
      } bg-[#f4f1ea]`}
    >
      <span className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">
        {recommended ? "Recommended" : "Option"}
      </span>
      <h4 className="mb-3 mt-1 text-base font-semibold">{name}</h4>
      <p className="mb-3 text-sm leading-relaxed text-[#77786f]">{position}</p>
      <ul className="mb-3 space-y-1 pl-4">
        {actions.map((a, i) => (
          <li key={i} className="text-xs leading-relaxed text-[#77786f]">
            {a}
          </li>
        ))}
      </ul>
      <p className="text-xs leading-relaxed text-[#77786f]">
        <b>适用：</b>
        {suitableWhen}
      </p>
      <p className="text-xs leading-relaxed text-[#77786f]">
        <b>风险：</b>
        {risk}
      </p>
    </article>
  );
}
