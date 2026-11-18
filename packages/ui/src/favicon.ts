/** The parts of a `<link>` element that the favicon code uses. */
export type IconLink = {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  dataset: Record<string, string | undefined>;
};

/** The attributes that describe the default icon. A custom logo removes them, so the browser does not skip it. */
const SAVED = ["href", "type", "sizes"] as const;
const key = (name: string) => `default${name[0]!.toUpperCase()}${name.slice(1)}`;

/**
 * Shows the site logo as the tab icon, or puts back the default icons from index.html.
 * index.html has more than one icon (ICO, SVG and the Apple touch icon), and browsers pick the SVG first.
 * So every icon link changes, not only the first.
 */
export function setFavicon(url: string | null, links: Iterable<IconLink>) {
  for (const link of links) {
    if (link.dataset.defaultSaved === undefined) {
      for (const name of SAVED) {
        const value = link.getAttribute(name);
        if (value !== null) link.dataset[key(name)] = value;
      }
      link.dataset.defaultSaved = "1";
    }
    if (url) {
      link.setAttribute("href", url);
      link.removeAttribute("type");
      link.removeAttribute("sizes");
      continue;
    }
    for (const name of SAVED) {
      const value = link.dataset[key(name)];
      if (value === undefined) link.removeAttribute(name);
      else link.setAttribute(name, value);
    }
  }
}

/** The icon links in the page head, the Apple touch icon included. */
export const iconLinks = (doc: Document): IconLink[] =>
  Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="apple-touch-icon"]'));
