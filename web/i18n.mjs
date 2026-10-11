import { english } from './locales/en.mjs';

export function selectLanguage(language) {
  return typeof language === 'string' && /^fr(?:-|$)/i.test(language) ? 'fr' : 'en';
}
export const language = typeof window === 'undefined' ? 'fr' : selectLanguage(navigator.language);
export const dateLocale = language === 'fr' ? 'fr-FR' : 'en';

// Template values (workflow names, IDs, server data) are never translated or interpreted as HTML.
export function translate(source, values = [], locale = language) {
  const pattern = locale === 'en' ? english[source] ?? source : source;
  return pattern.replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index]) : match);
}
export function t(source, ...values) {
  if (typeof source === 'string') return translate(source);
  const key = source.reduce((text, part, index) => text + (index ? `{${index - 1}}` : '') + part, '');
  return translate(key, values);
}
export function localizePage(document, locale = language) {
  document.documentElement?.setAttribute('lang', locale);
  if (!document.createTreeWalker) return;
  const walker = document.createTreeWalker(document.body, 4);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName)) continue;
    const source = node.textContent.trim();
    if (english[source]) node.textContent = node.textContent.replace(source, translate(source, [], locale));
  }
  for (const element of document.querySelectorAll('[placeholder], [aria-label], [title]')) {
    for (const attribute of ['placeholder', 'aria-label', 'title']) {
      const value = element.getAttribute(attribute);
      if (value && english[value]) element.setAttribute(attribute, translate(value, [], locale));
    }
  }
}
