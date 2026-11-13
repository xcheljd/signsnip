import type { BrandWithLogo } from "./api";
import { logoVersion } from "./logoVersion";

/**
 * Which logo a batch row's thumbnail shows: the brand's logo when it has one, or null when the
 * brand has no logo or was deleted. Null means "draw the no-logo placeholder and request nothing"
 * (asking the server for a logo that isn't there gives a 404 and a broken-image icon).
 * Pure, so it is tested without a browser (tests/logo-thumb.test.ts).
 */
export function logoThumb(brand: Pick<BrandWithLogo, "id" | "logo"> | undefined): { id: string; version: string } | null {
  return brand?.logo ? { id: brand.id, version: logoVersion(brand) } : null;
}
