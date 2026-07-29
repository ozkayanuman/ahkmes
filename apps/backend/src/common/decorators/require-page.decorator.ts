import { SetMetadata } from "@nestjs/common";
import type { PageKey } from "@ahkmes/shared-types";

export const PAGES_KEY = "pages";
/** Bu controller/route'un görünürlüğünü hangi NAV sayfa(lar)ının yönettiğini belirtir
 * — kullanıcının en az bir tanesine grup üzerinden erişimi olması yeterlidir. */
export const RequirePage = (...pages: PageKey[]) => SetMetadata(PAGES_KEY, pages);
