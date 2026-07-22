// Reuse the desktop app's app icon (resources/icon.svg) as both the browser
// favicon and the in-app logo. `?raw` inlines the SVG text into the bundle at
// build time, so there is no separate icon file to fetch at runtime.
import iconSvg from '@resources/icon.svg?raw'

export const ICON_SVG = iconSvg

/** The icon as a self-contained data: URI (used for the favicon and <img> logo). */
export const ICON_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(iconSvg)}`

/** Point the page favicon at the inlined icon (replaces the empty placeholder
 * in index.html that suppresses the default /favicon.ico network request). */
export function applyFavicon(): void {
  const link = document.getElementById('favicon') as HTMLLinkElement | null
  if (link) link.href = ICON_DATA_URI
}
