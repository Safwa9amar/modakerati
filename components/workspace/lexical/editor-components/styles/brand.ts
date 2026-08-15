// The editor's chrome accents (quote rule, checked box, drag grip, page gutter)
// are the brand — pulled from the token so a rebrand never has to visit these
// stylesheets. Interpolated into the CSS chunks that need it.

import { brand, rgbTriplet } from "@/constants/colors";

export const BRAND = brand.primary;
export const BRAND_RGB = rgbTriplet(brand.primary);
