// WinePortrait display: draws the book and turns its pages.
//
// The book has a cover, the index, then one page for each wine: the wines in
// the cellar, then the archive (wines with no bottles left), then the wines
// in the wild (tried somewhere else). A wine with notes gets a second page.
// The page reads the book live from Convex, with the key in its address
// (?key=…), so a change shows at once. Tap the right or left third of the
// screen to turn the page, or the middle third for the index. The arrow and
// page keys work too.

import { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../../convex/_generated/api';
import {
  BOIL_FILTERS,
  BOTTLES,
  GLASS_DARKNESS,
  drawBottle,
  drawLeader,
  drawLevel,
  drawRating,
  drawScaleBar,
  drawStain,
  drawTimeline,
  drawUnderline,
  escapeHtml,
  handLoop,
  seededRandom,
  svg,
} from '../../../shared/draw';
import './style.css';

type Collection = NonNullable<FunctionReturnType<typeof api.book.get>>;
type CellarWine = Collection['wines'][number];
type WildWine = Collection['wild'][number];
type Wine = CellarWine | WildWine;
type Page = () => string;
type IndexRow = Wine | { heading: string; column: string };

interface Book {
  title: string;
  cellar: CellarWine[];
  archive: CellarWine[];
  wild: WildWine[];
  entries: Wine[];
  addressOf: (wine: Wine) => string;
}

const THIS_YEAR = new Date().getFullYear();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STYLES: Record<Wine['type'], string> = { red: 'Red', white: 'White', rosé: 'Rosé', sparkling: 'Sparkling', fortified: 'Fortified' };
const LEVELS = { sweetness: 'Sweetness', acidity: 'Acidity', tannin: 'Tannin', body: 'Body', finish: 'Finish' } as const;
const PARTS = ['capsule', 'neck', 'shoulder', 'label', 'glass', 'base'] as const;
const INDEX_ROWS_PER_PAGE = 18;

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// '2026-09-20' becomes '20 Sep 2026'. '2026-09' and '2026' also work; other text stays as it is.
function formatDate(date: string) {
  const [year, month, day] = date.split('-');
  if (!/^\d{4}$/.test(year)) return date;
  return [day && Number(day), month && MONTHS[Number(month) - 1], year].filter(Boolean).join(' ');
}

// Cellar wines have a bottle count; wines in the wild do not.
function inCellar(wine: Wine): wine is CellarWine {
  return 'quantity' in wine;
}

// Sorts the wines into the pages of the book. Each page is a function that returns its HTML.
function makePages({ title, wines, wild }: Collection): Page[] {
  const cellar = wines.filter((wine) => wine.quantity);
  const archive = wines.filter((wine) => !wine.quantity);
  const entries: Wine[] = [...cellar, ...archive, ...wild];
  const section = (heading: string, column: string, list: Wine[]): IndexRow[] => (list.length ? [{ heading, column }, ...list] : []);
  const rows = [...section('In the cellar', 'Bottles', cellar), ...section('Archive', '', archive), ...section('In the wild', 'Tasted', wild)];
  const indexPages: IndexRow[][] = [];
  for (let i = 0; i < rows.length; i += INDEX_ROWS_PER_PAGE) indexPages.push(rows.slice(i, i + INDEX_ROWS_PER_PAGE));

  // The page number of each wine. A wine with notes has a second page after its own.
  const pageOf = new Map<Wine, number>();
  const book: Book = {
    title,
    cellar,
    archive,
    wild,
    entries,
    // The address of a wine's page, for example '#5'.
    addressOf: (wine) => `#${(pageOf.get(wine) ?? 0) + 1}`,
  };
  const pages: Page[] = [() => coverPage(book), ...indexPages.map((pageRows) => () => indexPage(book, pageRows))];
  entries.forEach((wine, i) => {
    pageOf.set(wine, pages.length);
    pages.push(() => entryPage(wine, i));
    if (wine.notes) pages.push(() => notesPage(wine));
  });
  return pages;
}

// ---- Pages -----------------------------------------------------------------

function coverPage({ title, cellar, archive, wild, addressOf }: Book): string {
  // A different bottle each time the cover shows: from the cellar, or else
  // from the archive, or else from the wines in the wild.
  const pool: Wine[] = [cellar, archive, wild].find((list) => list.length) ?? [];
  const wine = pool[Math.floor(Math.random() * pool.length)];
  let plate = '<p class="empty">No wines yet. Add your first bottle, and it shows here.</p>';
  if (wine) {
    const vintage = wine.vintage || 'NV';
    const bottle = drawBottle({
      form: wine.bottle,
      darkness: GLASS_DARKNESS[wine.type],
      label: { producer: wine.producer, name: wine.name, vintage },
      cx: 375,
      ground: 640,
      scale: Math.min(13, 400 / BOTTLES[wine.bottle].height),
      rand: seededRandom(`${wine.producer} ${wine.name} ${wine.vintage}`),
      id: 'cover',
    });
    plate = `
      ${svg(750, 1000, bottle.marks, 'plate', bottle.words)}
      <a class="feature" href="${addressOf(wine)}">
        <span class="plate-caption">Plate I. ${escapeHtml(wine.producer)}, ${escapeHtml(wine.name)}, ${vintage}.</span>
      </a>`;
  }
  const bottles = cellar.reduce((sum, each) => sum + each.quantity, 0);
  return `
    <div class="cover">
      <p class="cover-volume">Vol. I</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="cover-subtitle">the cellar, bottle by bottle</p>
      ${plate}
      <div class="fields">
        <p class="field"><i>In the cellar</i><b>${plural(bottles, 'bottle')} of ${plural(cellar.length, 'wine')}</b></p>
        <p class="field"><i>Archive</i><b>${plural(archive.length, 'wine')}</b></p>
        <p class="field"><i>In the wild</i><b>${plural(wild.length, 'wine')}</b></p>
      </div>
      <p class="hint">Tap the bottle to open its page. Tap the right edge to turn the page.</p>
    </div>`;
}

function indexPage({ entries, addressOf }: Book, rows: IndexRow[]): string {
  const rand = seededRandom('index');
  const items = rows.map((row) => {
    if ('heading' in row) {
      return `<li class="index-head"><span></span><span>${escapeHtml(row.heading)}</span><span>Vintage</span><span>${row.column}</span></li>`;
    }
    const detail = inCellar(row) ? row.quantity || '' : formatDate(row.tasted ?? '');
    return `
      <li><a class="index-row" href="${addressOf(row)}">
        <span>${entries.indexOf(row) + 1}</span>
        <span>${escapeHtml(row.producer)}, ${escapeHtml(row.name)}</span>
        <span>${row.vintage || 'NV'}</span>
        <span>${escapeHtml(detail)}</span>
      </a></li>`;
  });
  return `
    <div class="contents">
      <h1>Index</h1>
      ${drawUnderline(300, rand)}
      <ol class="index">${items.join('')}</ol>
    </div>`;
}

function entryPage(wine: Wine, index: number): string {
  const rand = seededRandom(`${wine.producer} ${wine.name} ${wine.vintage}`);
  const form = wine.bottle;
  const number = index + 1;
  const vintage = wine.vintage || 'NV';

  // Draw each bottle as large as the plate allows. The scale bar shows the true size.
  const scale = Math.min(18, 590 / BOTTLES[form].height);
  const bottle = drawBottle({
    form,
    darkness: GLASS_DARKNESS[wine.type],
    label: { producer: wine.producer, name: wine.name, vintage },
    cx: 262,
    ground: 690,
    scale,
    rand,
    id: 'bottle',
  });

  // Margin notes, each with an arrow to a part of the bottle.
  const sketch = wine.sketch ?? {};
  const noteRight = bottle.left - 28;
  let marginNotes = '';
  let arrows = '';
  let below = 0;
  for (const part of PARTS) {
    const note = sketch[part];
    if (!note) continue;
    const [x, y] = bottle.anchors[part];
    const top = Math.max(y - 11, below + 10);
    below = top + Math.ceil(note.length / 15) * 20; // a rough guess at the wrapped height
    marginNotes += `<p class="note" style="top:${top}px;width:${noteRight - 40}px">${escapeHtml(note)}</p>`;
    arrows += drawLeader([noteRight + 6, top + 11], [x, y], rand);
  }

  const alcohol = wine.alcohol ? `<p class="field"><i>Alcohol</i><b>${wine.alcohol}%</b></p>` : '';
  let status = '';
  if (inCellar(wine)) status = `<p class="field"><i>Bottles</i><b>${wine.quantity}</b></p>`;
  else if (wine.tasted) status = `<p class="field"><i>Tasted</i><b>${escapeHtml(formatDate(wine.tasted))}</b></p>`;

  const facts = (
    [
      ['Style', STYLES[wine.type]],
      ['Tried at', inCellar(wine) ? undefined : wine.where],
      ['Aromas', wine.aromas],
      ['Pairs with', wine.food],
    ] as [string, string | undefined][]
  )
    .filter((fact): fact is [string, string] => Boolean(fact[1]))
    .map(([name, value]) => `<dt>${name}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('');
  const rating = wine.rating ? `<dt>Rating</dt><dd>${drawRating(wine.rating, rand)}</dd>` : '';

  // About the wine. "What's in it" starts with the grapes.
  const about = (
    [
      ['Where it’s made', wine.place],
      ['History', wine.history],
      ['What’s in it', [wine.grapes.join(', '), wine.contents].filter(Boolean).join('. ')],
    ] as [string, string | undefined][]
  )
    .filter((section): section is [string, string] => Boolean(section[1]))
    .map(([heading, text]) => `<h2>${heading}</h2><p>${escapeHtml(text)}</p>`)
    .join('');

  let drinking = '';
  if (wine.window) {
    const [from, to] = wine.window;
    drinking = `
      <section class="window">
        <h2>Drinking window</h2>
        ${drawTimeline({ vintage: wine.vintage, from, to, mark: THIS_YEAR, markLabel: 'now' }, 410, rand)}
        <p class="status">${windowStatus(from, to, THIS_YEAR)}</p>
      </section>`;
  }

  const scaleBar = drawScaleBar(252, 742, scale, rand);
  const plate = svg(750, 1000, bottle.marks + arrows + scaleBar.marks, 'plate', bottle.words + scaleBar.words);

  let structure = '';
  if (wine.structure) {
    const levels = wine.structure;
    const rows = (Object.keys(LEVELS) as (keyof typeof LEVELS)[])
      .filter((key) => levels[key])
      .map((key) => `<dt>${LEVELS[key]}</dt><dd>${drawLevel(levels[key] ?? 0, rand)}</dd>`)
      .join('');
    structure = `
      <section class="structure">
        <div class="structure-head"><h2>Structure</h2><p><span>low</span><span>high</span></p></div>
        <dl>${rows}</dl>
      </section>`;
  }

  return `
    <header class="fields">
      <p class="field grow"><i>Region</i><b>${escapeHtml([wine.region, wine.country].filter(Boolean).join(', '))}</b></p>
      ${alcohol}
      ${status}
    </header>
    ${plate}
    ${marginNotes}
    <p class="caption">Fig. ${number}. ${BOTTLES[form].name} bottle, 75 cl.</p>
    <section class="entry">
      <h1 class="producer">${escapeHtml(wine.producer)}</h1>
      ${drawUnderline(300, rand)}
      <div class="cuvee">
        <span class="name">${escapeHtml(wine.name)}</span>
        <span class="vintage">${vintage}${svg(96, 50, handLoop(48, 25, 42, 19, rand, { width: 1.5, wobble: 0.7 }))}</span>
      </div>
      <dl class="facts">${facts}${rating}</dl>
      <div class="about">${about}</div>
    </section>
    ${drinking}
    ${structure}
    ${wine.notes ? '<p class="overleaf">Notes on the next page</p>' : ''}
    ${inCellar(wine) && !wine.quantity ? drawStain(rand) : ''}`;
}

// Your own notes about a wine, on the page after the wine's page.
function notesPage(wine: Wine): string {
  const name = `${wine.producer}, ${wine.name}, ${wine.vintage || 'NV'}`;
  return `
    <header class="fields">
      <p class="field grow"><i>Notes on</i><b>${escapeHtml(name)}</b></p>
    </header>
    <div class="notes">${escapeHtml(wine.notes ?? '')}</div>`;
}

function windowStatus(from: number, to: number, year: number) {
  if (year < from) return `Resting. Ready from ${from}.`;
  if (year > to) return 'Past its window.';
  return `Ready now. Best by ${to}.`;
}

// ---- Showing and turning pages ---------------------------------------------

const page = document.getElementById('page') as HTMLElement;
let pages: Page[] = [];
let current = 0;

function show(index: number) {
  current = Math.min(Math.max(index, 0), pages.length - 1);
  page.innerHTML = pages[current]();
  fitText();
  document.fonts.ready.then(fitText);
}

function showMessage(text: string) {
  page.innerHTML = `<p class="error">${escapeHtml(text)}</p>`;
}

// Shrinks text that is too long for its box, one pixel at a time.
// Handwriting reaches a few pixels past its line box, so a small overflow is allowed.
function fitText() {
  const boxes: [string, number, number][] = [
    ['.cover h1', 92, 40],
    ['.producer', 56, 30],
    ['.cuvee .name', 32, 18],
    ['.field.grow b', 22, 14],
    ['.about', 22, 14],
    ['.notes', 26, 16],
  ];
  for (const [selector, largest, smallest] of boxes) {
    for (const box of page.querySelectorAll<HTMLElement>(selector)) {
      let size = largest;
      do {
        box.style.fontSize = `${size}px`;
        size -= 1;
      } while (size >= smallest && (box.scrollHeight > box.clientHeight + 6 || box.scrollWidth > box.clientWidth + 1));
    }
  }
}

// The page is a fixed 750 × 1000 sheet, scaled to fit the screen.
function fitPage() {
  const scale = Math.min((innerWidth - 32) / 750, (innerHeight - 32) / 1000);
  page.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

// The address holds the page number (#1 is the cover), so a reload keeps your place.
function pageFromAddress() {
  return (parseInt(location.hash.slice(1), 10) || 1) - 1;
}

function turnTo(index: number) {
  location.hash = String(Math.min(Math.max(index, 0), pages.length - 1) + 1);
}

addEventListener('hashchange', () => show(pageFromAddress()));
addEventListener('resize', fitPage);

addEventListener('keydown', (event) => {
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) turnTo(current + 1);
  if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) turnTo(current - 1);
});

addEventListener('click', (event) => {
  if ((event.target as Element).closest('a')) return;
  const x = event.clientX / innerWidth;
  if (x < 1 / 3) turnTo(current - 1);
  else if (x > 2 / 3) turnTo(current + 1);
  else turnTo(1);
});

document.body.insertAdjacentHTML('beforeend', BOIL_FILTERS);
fitPage();

// The key stays in the address, so a share link can be bookmarked and the
// display's kiosk browser can start on it.
const key = new URLSearchParams(location.search).get('key');
if (!key) {
  showMessage('This page needs a key in its address, like …/?key=… Ask the owner of the book for a link.');
} else {
  const client = new ConvexClient(import.meta.env.VITE_CONVEX_URL);
  client.onUpdate(
    api.book.get,
    { key },
    (collection) => {
      if (!collection) return showMessage('The key in this link does not open a book. It may be revoked. Ask the owner for a new link.');
      document.title = collection.title;
      pages = makePages(collection);
      show(pageFromAddress());
    },
    (error) => showMessage(`The book could not load: ${error.message}`)
  );
}
