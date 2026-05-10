import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

export default createMiddleware(routing);

export const config = {
  // /api, /_next, /_vercel, ファイル(ドット含む)を除外
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
};
