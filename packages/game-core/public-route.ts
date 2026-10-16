// The only released practice puzzle. Never infer candidate IDs from URLs.
export const publicPracticeId = "playtest-fixed-v1";
export const publicOrigin = "https://onebox.formflow-ops.com";
export type PublicLocale = "ja" | "en";
export function publicMetadata(locale: PublicLocale) {
  return locale === "ja"
    ? {
        title: "ONEBOX — 4つの形を、ひとつの箱に。",
        description:
          "登録不要。4つの形をひとつの箱へ。固定問題の試遊版を遊べます。日次配信は準備中。",
      }
    : {
        title: "ONEBOX — Four pieces. One perfect fit.",
        description:
          "No sign-up. Fit four pieces into one box. Play a fixed practice puzzle while daily puzzles are being prepared.",
      };
}
export function fixedPath(locale: PublicLocale) {
  return `/${locale}/p/${publicPracticeId}/`;
}
export function publicRoute(path: string, search = "") {
  if (search && search !== "?src=share") return null;
  if (["/", "/index.html", "/ja/"].includes(path))
    return {
      locale: "ja" as const,
      fixed: false,
      file: path === "/ja/" ? "ja/index.html" : "index.html",
    };
  if (path === "/en/")
    return { locale: "en" as const, fixed: false, file: "en/index.html" };
  for (const locale of ["ja", "en"] as const)
    if (path === fixedPath(locale))
      return {
        locale,
        fixed: true,
        file: `${locale}/p/${publicPracticeId}/index.html`,
      };
  return null;
}
