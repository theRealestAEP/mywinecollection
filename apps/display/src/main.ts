// WinePortrait display: draws the book and turns its pages.
//
// The book has a cover, the index, the consumed log (each bottle opened, and
// each wine tried somewhere else), then one page for each wine: the wines in
// the cellar, then the archive (wines with no bottles left), then the wines
// in the wild (tried somewhere else). Your own notes about a wine take the
// place of the written sections about it.
// The page reads the book live from Convex, with the key in its address
// (?key=…), so a change shows at once. On the sheet, tap the right or left
// third of the screen to turn the page, or the middle third for the index.
// On a phone, the page is one column that scrolls, with a bar of buttons at
// the foot of the screen. The ‹ and › buttons, a swipe, and the arrow and
// page keys also turn the page.

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
type Drink = Collection['drinks'][number];
type Page = () => string;
type IndexRow = Wine | { heading: string; column: string };

interface Book {
  title: string;
  cellar: CellarWine[];
  archive: CellarWine[];
  wild: WildWine[];
  entries: Wine[];
  indexPages: IndexRow[][];
  drinks: Drink[];
  consumedPages: Drink[][];
  // The addresses of the cover's three buttons.
  shelves: { cellar: string; consumed: string; archive: string };
  addressOf: (wine: Wine) => string;
  wineOf: (drink: Drink) => Wine | undefined;
  find: (query: string) => IndexRow[];
}

const THIS_YEAR = new Date().getFullYear();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STYLES: Record<Wine['type'], string> = { red: 'Red', white: 'White', rosé: 'Rosé', sparkling: 'Sparkling', fortified: 'Fortified' };
const LEVELS = { sweetness: 'Sweetness', acidity: 'Acidity', tannin: 'Tannin', body: 'Body', finish: 'Finish' } as const;
const PARTS = ['capsule', 'neck', 'shoulder', 'label', 'glass', 'base'] as const;
const INDEX_ROWS_PER_PAGE = 18;
// On a phone, the page is one column this wide, zoomed to fill the screen.
const COLUMN = 420;
// How long a new page takes to ink itself in, in milliseconds.
const INK_TIME = 900;

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

// Sorts the wines into the sections of the book, and lays out the index.
function makeBook({ title, wines, wild, drinks }: Collection): Book {
  const cellar = wines.filter((wine) => wine.quantity);
  const archive = wines.filter((wine) => !wine.quantity);
  const entries: Wine[] = [...cellar, ...archive, ...wild];
  const rows = indexRows(cellar, archive, wild);
  const indexPages: IndexRow[][] = [];
  for (let i = 0; i < rows.length; i += INDEX_ROWS_PER_PAGE) indexPages.push(rows.slice(i, i + INDEX_ROWS_PER_PAGE));
  // The consumed log has at least one page, so that its button leads somewhere.
  const consumedPages: Drink[][] = [];
  for (let i = 0; i < drinks.length; i += INDEX_ROWS_PER_PAGE) consumedPages.push(drinks.slice(i, i + INDEX_ROWS_PER_PAGE));
  if (!consumedPages.length) consumedPages.push([]);
  const firstConsumedPage = 1 + indexPages.length;
  const firstEntryPage = firstConsumedPage + consumedPages.length;
  const archiveRow = rows.findIndex((row) => 'heading' in row && row.heading === 'Archive');
  const byId = new Map<string, Wine>(entries.map((wine) => [wine._id, wine]));
  const texts = new Map(entries.map((wine) => [wine, plain(searchText(wine))]));
  return {
    title,
    cellar,
    archive,
    wild,
    entries,
    indexPages,
    drinks,
    consumedPages,
    shelves: {
      cellar: '#2',
      consumed: `#${firstConsumedPage + 1}`,
      archive: `#${2 + Math.floor(Math.max(archiveRow, 0) / INDEX_ROWS_PER_PAGE)}`,
    },
    // The address of a wine's page, for example '#5'.
    addressOf: (wine) => `#${firstEntryPage + entries.indexOf(wine) + 1}`,
    wineOf: (drink) => byId.get(drink.wine),
    // A search finds the wines that have every word of the query, as index rows.
    find: (query) => {
      const words = plain(query).split(/\s+/).filter(Boolean);
      const match = (wine: Wine) => words.every((word) => texts.get(wine)?.includes(word));
      return indexRows(cellar.filter(match), archive.filter(match), wild.filter(match));
    },
  };
}

// Each page is a function that returns its HTML.
function makePages(book: Book): Page[] {
  return [
    () => coverPage(book),
    ...book.indexPages.map((rows, i) => () => indexPage(book, rows, i === 0)),
    ...book.consumedPages.map((drinks) => () => consumedPage(book, drinks)),
    ...book.entries.map((wine, i) => () => entryPage(wine, i)),
  ];
}

// The index: a heading for each section that has wines, then its wines.
function indexRows(cellar: Wine[], archive: Wine[], wild: Wine[]): IndexRow[] {
  const section = (heading: string, column: string, list: Wine[]): IndexRow[] => (list.length ? [{ heading, column }, ...list] : []);
  return [...section('In the cellar', 'Bottles', cellar), ...section('Archive', '', archive), ...section('In the wild', 'Tasted', wild)];
}

// All the words about a wine, for search.
function searchText(wine: Wine) {
  const words = [
    wine.producer,
    wine.name,
    wine.vintage,
    wine.region,
    wine.country,
    ...wine.grapes,
    STYLES[wine.type],
    wine.place,
    wine.history,
    wine.contents,
    wine.aromas,
    wine.food,
    wine.notes,
    ...Object.values(wine.sketch ?? {}),
  ];
  if (!inCellar(wine)) words.push(wine.tasted, wine.where);
  return words.filter(Boolean).join(' ');
}

// Lower case and without accents, so that a search for "rose" finds "Rosé".
function plain(text: string) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// ---- Pages -----------------------------------------------------------------

function coverPage({ title, cellar, archive, wild, drinks, shelves, addressOf }: Book): string {
  // A different bottle each time the cover shows: from the cellar, or else
  // from the archive, or else from the wines in the wild.
  const pool: Wine[] = [cellar, archive, wild].find((list) => list.length) ?? [];
  const wine = pool[Math.floor(Math.random() * pool.length)];
  let plate = '<p class="empty">No wines yet. Add your first bottle, and it shows here.</p>';
  if (wine) {
    const vintage = wine.vintage || 'NV';
    // On the sheet, the drawing spans the whole page. On a phone, it is a
    // block of its own in the column, small enough that the title, the
    // bottle, its caption and the three buttons fit on the first screen,
    // above the bar at the foot. The rest of that screen takes about 560
    // column units.
    const room = phone ? Math.max(200, Math.min(400, columnHeight - 560)) : 400;
    const [width, height, cx, ground] = phone ? [COLUMN, room + 100, COLUMN / 2, room + 50] : [750, 1000, 375, 640];
    const bottle = drawBottle({
      form: wine.bottle,
      darkness: GLASS_DARKNESS[wine.type],
      label: { producer: wine.producer, name: wine.name, vintage },
      cx,
      ground,
      scale: Math.min(13, room / BOTTLES[wine.bottle].height),
      rand: seededRandom(`${wine.producer} ${wine.name} ${wine.vintage}`),
      id: 'cover',
    });
    plate = `
      ${svg(width, height, bottle.marks, 'plate', bottle.words)}
      <a class="feature" href="${addressOf(wine)}">
        <span class="plate-caption">Plate I. ${escapeHtml(wine.producer)}, ${escapeHtml(wine.name)}, ${vintage}.</span>
      </a>`;
  }
  const bottles = cellar.reduce((sum, each) => sum + each.quantity, 0);
  const hint = phone
    ? 'Tap the bottle to open its page. Swipe to turn the page.'
    : 'Tap the bottle to open its page. Tap the right edge to turn the page, or the middle to search.';
  return `
    <div class="cover">
      <p class="cover-volume">Vol. I</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="cover-subtitle">the cellar, bottle by bottle</p>
      <div class="figure">${plate}</div>
      <nav class="fields shelves">
        <a class="field" href="${shelves.cellar}"><i>Cellar</i><b>${plural(bottles, 'bottle')} of ${plural(cellar.length, 'wine')}</b></a>
        <a class="field" href="${shelves.consumed}"><i>Consumed</i><b>${drinks.length ? `${drinks.length} in the log` : 'nothing yet'}</b></a>
        <a class="field" href="${shelves.archive}"><i>Archive</i><b>${plural(archive.length, 'wine')}</b></a>
      </nav>
      <p class="hint">${hint}</p>
    </div>`;
}

// The first index page has the search box. While the box holds a search, that
// page lists what the search finds.
function indexPage(book: Book, rows: IndexRow[], first: boolean): string {
  const rand = seededRandom('index');
  const search = first
    ? `<label class="field search"><i>Search</i><input type="search" value="${escapeHtml(query)}" autocomplete="off" /></label>`
    : '';
  return `
    <div class="contents">
      <h1>Index</h1>
      ${drawUnderline(300, rand)}
      ${search}
      <ol class="index">${first && query ? foundItems(book) : indexItems(book, rows)}</ol>
    </div>`;
}

function indexItems({ entries, addressOf }: Book, rows: IndexRow[]): string {
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
  return items.join('');
}

// The consumed log, newest first: one line for each bottle opened, and for
// each wine tried somewhere else. Each line leads to the wine's page.
function consumedPage({ wineOf, addressOf }: Book, drinks: Drink[]): string {
  const rand = seededRandom('consumed');
  const rows = drinks.map((drink) => {
    const wine = wineOf(drink);
    if (!wine) return '';
    return `
      <li><a class="index-row log-row" href="${addressOf(wine)}">
        <span>${escapeHtml(formatDate(drink.date))}</span>
        <span>${escapeHtml(wine.producer)}, ${escapeHtml(wine.name)}</span>
        <span>${wine.vintage || 'NV'}</span>
        <span>${escapeHtml(drink.where ?? '')}</span>
        ${drink.notes ? `<span class="log-notes">${escapeHtml(drink.notes)}</span>` : ''}
      </a></li>`;
  });
  return `
    <div class="contents">
      <h1>Consumed</h1>
      ${drawUnderline(300, rand)}
      <ol class="index">
        <li class="index-head log-row"><span>Date</span><span>Wine</span><span>Vintage</span><span>Where</span></li>
        ${rows.join('') || '<li class="index-note">Nothing in the log yet.</li>'}
      </ol>
    </div>`;
}

// What the search finds, on one index page.
function foundItems(book: Book): string {
  const rows = book.find(query);
  if (!rows.length) return `<li class="index-note">Nothing matches “${escapeHtml(query)}”.</li>`;
  if (rows.length <= INDEX_ROWS_PER_PAGE) return indexItems(book, rows);
  return `${indexItems(book, rows.slice(0, INDEX_ROWS_PER_PAGE - 1))}<li class="index-note">There are more. Add a word to the search.</li>`;
}

function entryPage(wine: Wine, index: number): string {
  const rand = seededRandom(`${wine.producer} ${wine.name} ${wine.vintage}`);
  const form = wine.bottle;
  const number = index + 1;
  const vintage = wine.vintage || 'NV';

  // On the sheet, the drawing takes the left of the page. On a phone, it is a
  // block of its own under the wine's name, small enough that the name, the
  // bottle and its caption fit on the first screen, above the bar at the
  // foot. The rest of that screen takes about 360 column units. There the
  // bottle stands in the middle, or to the right when margin notes need room
  // on its left.
  const sketch = wine.sketch ?? {};
  const hasNotes = PARTS.some((part) => sketch[part]);
  const cx = phone && !hasNotes ? COLUMN / 2 : 262;
  const room = phone ? Math.max(300, Math.min(500, columnHeight - 360)) : 590;
  const ground = phone ? room + 20 : 690;
  // Draw each bottle as large as the plate allows. The scale bar shows the true size.
  const scale = Math.min(18, room / BOTTLES[form].height);
  const bottle = drawBottle({
    form,
    darkness: GLASS_DARKNESS[wine.type],
    label: { producer: wine.producer, name: wine.name, vintage },
    cx,
    ground,
    scale,
    rand,
    id: 'bottle',
  });

  // Margin notes, each with an arrow to a part of the bottle.
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

  // About the wine: your own notes, or else where it's made, its history and
  // what's in it. "What's in it" starts with the grapes.
  const sections: [string, string | undefined][] = wine.notes
    ? [['Notes', wine.notes]]
    : [
        ['Where it’s made', wine.place],
        ['History', wine.history],
        ['What’s in it', [wine.grapes.join(', '), wine.contents].filter(Boolean).join('. ')],
      ];
  const about = sections
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

  // The 5 cm scale bar sits centred under the bottle.
  const scaleBar = drawScaleBar(cx - 2.5 * scale, ground + 52, scale, rand);
  const [plateWidth, plateHeight] = phone ? [COLUMN, ground + 90] : [750, 1000];
  const plate = svg(plateWidth, plateHeight, bottle.marks + arrows + scaleBar.marks, 'plate', bottle.words + scaleBar.words);

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
    <div class="figure">
      ${plate}
      ${marginNotes}
      <p class="caption" style="left:${cx - 150}px;top:${ground + 66}px">Fig. ${number}. ${BOTTLES[form].name} bottle, 75 cl.</p>
    </div>
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
    ${inCellar(wine) && !wine.quantity ? drawStain(rand) : ''}`;
}

function windowStatus(from: number, to: number, year: number) {
  if (year < from) return `Resting. Ready from ${from}.`;
  if (year > to) return 'Past its window.';
  return `Ready now. Best by ${to}.`;
}

// ---- Showing and turning pages ---------------------------------------------

const page = document.getElementById('page') as HTMLElement;
// On an e-ink screen (see index.html), and on a device that asks for less
// motion, pages turn instantly, with no ink-in.
const eink = document.documentElement.classList.contains('eink');
const motion = !eink && matchMedia('(prefers-reduced-motion: no-preference)').matches;

// The e-ink tablet on the wall stays awake while it shows the book, so that
// it does not sleep and cover the page. The tablet lets go of the lock when
// the book is hidden, so ask again when the book shows.
if (eink && 'wakeLock' in navigator) {
  const stayAwake = () => navigator.wakeLock.request('screen').catch(() => {});
  stayAwake();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') stayAwake();
  });
}

// A browser shows its own bars above the page. On the e-ink tablet, the first
// tap puts the book in full screen, without them: a browser allows full
// screen only after a tap.
if (eink) {
  addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  });
}
let book: Book;
let pages: Page[] = [];
let current = 0;
let shown = -1;
// A phone shows the page as one column that scrolls (see fitPage). Its
// screen is this many column units tall.
let phone = false;
let columnHeight = 0;
// The words in the search box. They stay while you turn pages.
let query = '';

function show(index: number) {
  current = Math.min(Math.max(index, 0), pages.length - 1);
  page.innerHTML = pages[current]() + turnButtons();
  fitText();
  document.fonts.ready.then(fitText);
  // A new page starts at the top, and inks itself in. A change to the
  // book redraws the page you are on as it is.
  if (current !== shown) {
    scrollTo(0, 0);
    if (motion) inkIn();
  }
  shown = current;
}

// A new page inks itself in: its pen marks appear one after another, the
// outline of the bottle first and its shadow on the ground last, as if drawn
// while you watch. Then the lines boil again.
let inkDone: ReturnType<typeof setTimeout> | undefined;
function inkIn() {
  const drawing = [...page.querySelectorAll<SVGElement>('.plate .boil > *')].reverse();
  const smallMarks = [...page.querySelectorAll<SVGElement>('.boil > *')].filter((mark) => !mark.closest('.plate'));
  const marks = [...drawing, ...smallMarks];
  marks.forEach((mark, i) => {
    mark.style.animationDelay = `${Math.round((i / marks.length) * INK_TIME)}ms`;
  });
  page.classList.add('inking');
  clearTimeout(inkDone);
  inkDone = setTimeout(() => page.classList.remove('inking'), INK_TIME + 400);
}

// The ‹ and › buttons, at the edges of the sheet or in the bar at the foot of
// a phone's screen. The phone's bar also has a way to the index. The cover
// has no ‹, and the last page has no ›.
function turnButtons() {
  const back = current > 0 ? `<a class="turn back" href="#${current}" aria-label="Previous page">‹</a>` : '';
  const next = current < pages.length - 1 ? `<a class="turn next" href="#${current + 2}" aria-label="Next page">›</a>` : '';
  const onIndex = current >= 1 && current <= book.indexPages.length;
  const index = onIndex ? '' : '<a class="turn index" href="#2">Index</a>';
  return `<nav class="turns">${back}${index}${next}</nav>`;
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

// The page is a fixed 750 × 1000 sheet, scaled to fit the screen. On a phone,
// that sheet would be too small to read, so the page becomes one column of
// paper, as wide as the screen, that scrolls. The screen size comes from the
// root element: on phones, innerWidth also counts the part of the sheet that
// sticks out past the screen before it is scaled.
function fitPage() {
  const { clientWidth, clientHeight } = document.documentElement;
  const wasPhone = phone;
  const wasHeight = columnHeight;
  phone = !eink && (clientWidth < 600 || clientHeight < 500);
  document.documentElement.classList.toggle('phone', phone);
  if (phone) {
    const zoom = Math.min(clientWidth, 520) / COLUMN;
    columnHeight = Math.round(clientHeight / zoom);
    page.style.transform = '';
    page.style.zoom = String(zoom);
    page.style.minHeight = `${clientHeight / zoom}px`;
  } else {
    const scale = Math.min((clientWidth - 32) / 750, (clientHeight - 32) / 1000);
    page.style.zoom = '';
    page.style.minHeight = '';
    page.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }
  // The phone column and the sheet draw some pages in different ways, and a
  // phone sizes its drawings to the screen.
  if ((phone !== wasPhone || columnHeight !== wasHeight) && pages.length) show(current);
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
  // Keys in the search box type. Enter closes the on-screen keyboard, so that
  // the whole list of results shows.
  if (event.target instanceof HTMLInputElement) {
    if (event.key === 'Enter') event.target.blur();
    return;
  }
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) turnTo(current + 1);
  if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) turnTo(current - 1);
});

// Search as you type. Only the list changes, so the search box keeps the keyboard open.
page.addEventListener('input', (event) => {
  query = (event.target as HTMLInputElement).value;
  const list = page.querySelector('.index');
  if (list) list.innerHTML = query ? foundItems(book) : indexItems(book, book.indexPages[0]);
});

// Tap the left or right third of the sheet to turn the page, or the middle
// for the index. On a phone, a tap is part of reading and scrolling, so it
// turns nothing: the bar at the foot of the screen and a swipe do.
addEventListener('click', (event) => {
  if (phone || (event.target as Element).closest('a, label')) return;
  const x = event.clientX / document.documentElement.clientWidth;
  if (x < 1 / 3) turnTo(current - 1);
  else if (x > 2 / 3) turnTo(current + 1);
  else turnTo(1);
});

// Swipe left for the next page, and right for the previous one. A touch with
// two fingers is a pinch, not a swipe. While the page is zoomed in, a swipe
// moves around the page, so it does not turn it.
let swipeStart: { x: number; y: number } | undefined;
addEventListener('touchstart', (event) => {
  const [touch] = event.touches;
  swipeStart = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : undefined;
});
addEventListener('touchend', (event) => {
  if (!swipeStart || event.touches.length || (visualViewport?.scale ?? 1) > 1) return;
  const [touch] = event.changedTouches;
  const dx = touch.clientX - swipeStart.x;
  const dy = touch.clientY - swipeStart.y;
  swipeStart = undefined;
  if (Math.abs(dx) > 50 && Math.abs(dx) > 2 * Math.abs(dy)) turnTo(current + (dx < 0 ? 1 : -1));
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
      book = makeBook(collection);
      pages = makePages(book);
      show(pageFromAddress());
    },
    (error) => showMessage(`The book could not load: ${error.message}`)
  );
}
