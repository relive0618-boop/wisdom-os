import { ReportQualitySchema, type Report, type ReportQuality } from "@wisdom/shared";

const ABSOLUTE_WORDS = /(一定|必然|绝对|保证|百分之百|never|always|guaranteed)/i;

function similarity(left: string, right: string) {
  const a = new Set(left.toLowerCase().split(/\s+/).filter(Boolean));
  const b = new Set(right.toLowerCase().split(/\s+/).filter(Boolean));
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return overlap / Math.min(a.size, b.size);
}

export function assessReportQuality(report: Report, originalQuestion = ""): ReportQuality {
  const warnings: string[] = [];
  if (report.strategies.length !== 3) warnings.push("strategies 必须正好三项");
  for (let index = 0; index < report.strategies.length; index += 1) {
    for (let next = index + 1; next < report.strategies.length; next += 1) {
      if (similarity(`${report.strategies[index].position} ${report.strategies[index].actions.join(" ")}`, `${report.strategies[next].position} ${report.strategies[next].actions.join(" ")}`) >= 0.8) {
        warnings.push("策略内容高度重复");
      }
    }
  }
  if (report.recommended_strategy.length < 20 || !/(因为|原因|理由|由于|考虑)/.test(report.recommended_strategy)) warnings.push("recommended_strategy 缺少明确推荐理由");
  if (report.risks.length < 3) warnings.push("risks 至少需要三项");
  if (report.action_plan_7d.length !== 7) warnings.push("action_plan_7d 必须正好七项");
  if (report.review_questions.length < 3) warnings.push("review_questions 至少需要三项");
  if (report.citations.length < 2) warnings.push("citations 至少需要两项");
  if (ABSOLUTE_WORDS.test(`${report.situation_assessment} ${report.recommended_strategy} ${report.strategies.map((item) => item.position).join(" ")}`)) warnings.push("报告含有明显绝对化字词");
  if (originalQuestion && similarity(report.situation_assessment, originalQuestion) >= 0.8) warnings.push("situation_assessment 只是重复问题");

  const qualityScore = Math.max(0, 100 - warnings.length * 35);
  return ReportQualitySchema.parse({ qualityScore, qualityWarnings: [...new Set(warnings)], qualityPassed: qualityScore >= 70 });
}
