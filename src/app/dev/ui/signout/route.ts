import { cookies } from "next/headers";
import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { hashToken } from "@/lib/tokens";
import { requireUiPreview } from "@/lib/ui-preview";

export async function GET() {
  await requireUiPreview();
  const jar = await cookies();
  const token = jar.get("fl_session")?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    revalidateTag(`session:${token}`, { expire: 0 });
  }
  jar.delete("fl_session");
  redirect("/signin");
}
