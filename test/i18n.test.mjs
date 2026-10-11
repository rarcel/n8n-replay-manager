import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectLanguage, translate, localizePage } from '../web/i18n.mjs';
import { english } from '../web/locales/en.mjs';

test('primary browser language selects French variants and English for all others', () => {
  for (const value of ['fr', 'fr-FR', 'fr-CA', 'FR-be']) assert.equal(selectLanguage(value), 'fr');
  for (const value of ['en', 'en-US', 'de-DE', 'es', 'ar', '', undefined, 'french']) assert.equal(selectLanguage(value), 'en');
});

test('templates translate labels without modifying or interpreting source values', () => {
  const source = 'Connecté · {0}', name = '<img src=x onerror=alert(1)> workflow actuel {0}';
  assert.equal(translate(source, [name], 'en'), `Signed in · ${name}`);
  assert.equal(translate(source, [name], 'fr'), `Connecté · ${name}`);
  assert.equal(translate('{0}/{1} vérifiées · {2} compatibles. Aucun envoi.', [2, 3, 2], 'en'), '2/3 checked · 2 compatible. Nothing submitted.');
  assert.equal(translate('Aucune exécution sur cette page pour ces filtres.', [], 'en'), 'No executions on this page match these filters.');
});

test('static text and accessible attributes translate with whitespace and markup preserved', () => {
  for (const locale of ['fr', 'en']) {
    const text = {textContent: '  Choisir le workflow  ', parentElement: {tagName: 'H2'}}, untouched = {textContent: 'received workflow name', parentElement: {tagName: 'DIV'}};
    const attrs = {placeholder: 'Choisir ou rechercher un workflow…', 'aria-label': 'Workflows accessibles'};
    const element = {getAttribute: key => attrs[key], setAttribute: (key, value) => { attrs[key] = value; }};
    let index = -1, lang;
    const walker = {nextNode() { index++; this.currentNode = [text, untouched][index]; return index < 2; }};
    localizePage({documentElement: {setAttribute: (_, value) => { lang = value; }}, body: {}, createTreeWalker: () => walker, querySelectorAll: () => [element]}, locale);
    assert.equal(lang, locale);
    assert.equal(text.textContent, locale === 'en' ? '  Choose workflow  ' : '  Choisir le workflow  ');
    assert.equal(attrs.placeholder, locale === 'en' ? 'Choose or search for a workflow…' : 'Choisir ou rechercher un workflow…');
    assert.equal(untouched.textContent, 'received workflow name');
  }
});

test('every static interface label and translation call has an English entry', () => {
  const html = readFileSync('web/index.html', 'utf8');
  const neutral = /^(?:Replay Manager(?: · n8n)?|n8n|Workflow|· version|\d+|[↻↗◇/:×])$/;
  for (const match of html.matchAll(/>([^<>]+)</g)) {
    const text = match[1].trim();
    if (text && !neutral.test(text)) assert.ok(english[text], `Missing static translation: ${text}`);
  }
  for (const match of html.matchAll(/(?:placeholder|aria-label)="([^"]+)"/g)) assert.ok(english[match[1]], `Missing attribute translation: ${match[1]}`);
  for (const file of ['app', 'catalog', 'explorer', 'workflow-picker']) {
    for (const match of readFileSync(`web/${file}.mjs`, 'utf8').matchAll(/\bt\(("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\)/g)) {
      const source = match[1][0] === '"' ? JSON.parse(match[1]) : match[1].slice(1, -1);
      assert.ok(english[source], `Missing dynamic translation: ${source}`);
    }
  }
});
