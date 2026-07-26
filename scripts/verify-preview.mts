import { formatPreviewVerification, parsePreviewVerifierArgs, PreviewVerifierUsageError, verifyPreview } from "./verify-preview-lib";

async function main() {
  try {
    const { baseUrl, allowLocal, transport } = parsePreviewVerifierArgs(process.argv.slice(2));
    const result = await verifyPreview({ baseUrl, allowLocal, transport });
    console.log(formatPreviewVerification(result));
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    if (error instanceof PreviewVerifierUsageError) console.error("Usage: pnpm verify:preview -- --base-url <HTTPS_PREVIEW_URL> [--allow-local | --vercel-protected]");
    else console.error("Preview verification: FAIL");
    process.exitCode = 1;
  }
}

void main();
