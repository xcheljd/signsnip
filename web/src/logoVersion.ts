import type { BrandWithLogo } from "./api";

/**
 * What a brand's logo looks like right now, for <img> URLs: the hash of its stored bytes
 * (LogoInfo.version). A replaced logo gets a new value even when it has the same size.
 */
export const logoVersion = (b: Pick<BrandWithLogo, "logo"> | undefined): string => b?.logo?.version ?? "none";

/**
 * Key of every brand's logo as it prints (bytes + size setting), for PDF previews and checks:
 * when it changes, anything rendered with the old logos is out of date.
 */
export const logosKey = (brands: Pick<BrandWithLogo, "id" | "logoScale" | "logo">[]): string =>
  brands.map((b) => `${b.id}:${b.logoScale}:${logoVersion(b)}`).join("|");
