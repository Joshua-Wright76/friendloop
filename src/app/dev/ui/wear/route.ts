import { redirect } from "next/navigation";
import { UI_PREVIEW, enableUiPreview, wearPreviewLook } from "@/lib/ui-preview";

/** Tries an outfit on the demo loop, then opens a round wearing it. */
export async function GET(request: Request) {
  if (!(await enableUiPreview())) redirect("/dev/stats");
  const worn = await wearPreviewLook(new URL(request.url).searchParams.get("look"));
  redirect(worn ? `/i/${UI_PREVIEW.deliveredIssueId}?m=${UI_PREVIEW.ownerToken}` : "/dev/screens");
}
