# Wine Portraits

A drawn book of your wine cellar, made for e-ink tablets. Each wine gets a page with:

- a pen-and-ink drawing of its bottle, with notes in the margin
- its style, aromas, food pairing and rating
- where it is made, its history, and what is in it
- a drinking-window timeline
- a chart of its structure: sweetness, acidity, tannin, body and finish

Your own notes about a wine take the place of the written sections about it.

The index has a search box. A search finds the wines that have every word you type, in any field or in your notes. It ignores case and accents, so "rose" finds "Rosé".

The cover has three buttons:

| Button | Opens |
| --- | --- |
| Cellar | The index: the wines you have bottles of, then the archive, then the wines you tried somewhere else |
| Consumed | The drinking log: each bottle you opened, and each wine you tried somewhere else, with the date |
| Archive | The wines you logged in the cellar that have no bottles left |

On your phone, the Sommelier page keeps the book up to date. Send it a photo, a video, a voice note or a few words about a wine, and an AI agent adds the wine or logs the bottle you opened. When it needs to know more, it asks.

The pages are made for e-ink tablets, and they also work on phones and computers:

- Each page is a fixed 3:4 sheet, the shape of most e-ink screens.
- All tone comes from hatched lines, with no gradients.
- The page uses three inks that stay clear in greyscale.
- On a phone, the page becomes one column of paper that you scroll. The wine's name and its portrait come first, at a size you can read.
- On a phone or a computer, each new page inks itself in: its drawing appears stroke by stroke, outline first. Then the pen lines "boil": they wobble a little, as in hand-drawn animation.
- On an e-ink tablet, add `&eink` to the end of the link. The page then fills the screen with paper and turns instantly, with no ink-in, because e-ink redraws slowly. The lines still boil; for the smoothest boil, set a fast refresh mode for the browser in the tablet's e-ink settings.
- On other screens, the page keeps still when the device asks for reduced motion.

## How it works

Each person runs their own copy. One Convex deployment holds one book: its title, its wines, the drinking log, the talk with the sommelier, and its access keys. The site is static, and Cloudflare can host it for free.

A screen opens the book with an access key in its address (`…/?key=…`). There are three kinds:

| Kind | For | Notes |
| --- | --- | --- |
| `display` | A tablet in your home | It can only read the book. |
| `share` | A view-only link for friends | It can only read the book. You can revoke it at any time. |
| `owner` | The Sommelier page on your phone | It can change the book, through the sommelier. |

The book follows live data: a change in Convex shows on every open screen at once.

## Folders

| Folder | What it holds |
| --- | --- |
| `convex/` | The backend: the schema, the book query, and admin functions |
| `apps/display/` | The book, for e-ink tablets and share links, and the Sommelier page |
| `shared/draw.ts` | The pen-and-ink drawing |
| `shared/wines.schema.json` | The format of a collection file, for import, export and AI tools |
| `seed/wines.json` | Ten sample wines |
| `scripts/` | Check and import collection files |
| `.claude/skills/add-wine/` | A Claude Code skill that adds wines from photos |

## Make your own book

You need Node.js 22.12 or later and a free [Convex](https://convex.dev) account.

1. Fork or clone this repo, then install the packages:

   ```bash
   npm install
   ```

2. Start the backend. The first time, it asks you to log in and make a Convex project. It then pushes the functions to your dev deployment and keeps them in sync while you work:

   ```bash
   npx convex dev
   ```

3. In a second terminal, load the sample wines. To start with an empty book, skip this step.

   ```bash
   npm run import-wines -- seed/wines.json
   ```

4. Give the book a title:

   ```bash
   npx convex run settings:setTitle '{"title": "The Cellar"}'
   ```

5. Make a key. The command shows the key only once, so copy it:

   ```bash
   npx convex run accessKeys:create '{"kind": "display", "name": "My computer"}'
   ```

6. Start the book, then open `http://localhost:5180/?key=<key>`:

   ```bash
   npm run dev
   ```

## Put it on the web

The book deploys to a Convex production deployment and to Cloudflare. You need a free [Cloudflare](https://cloudflare.com) account.

1. Log in to Cloudflare:

   ```bash
   npx wrangler login
   ```

2. Deploy the backend to production, and build the site with its URL:

   ```bash
   npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name VITE_CONVEX_URL
   ```

3. Upload the site. Cloudflare serves it as the static files of a Worker, and the command shows the Worker's address. To use another name, change `name` in `wrangler.jsonc`.

   ```bash
   npx wrangler deploy
   ```

4. Copy your wines from dev to production:

   ```bash
   npx convex run wines:exportCollection > book.json
   npm run import-wines -- book.json --prod
   ```

5. Make a key for production:

   ```bash
   npx convex run --prod accessKeys:create '{"kind": "display", "name": "Wall tablet"}'
   ```

6. Open `https://<the Worker's address>/?key=<key>`. On an e-ink tablet, add `&eink` to the end of the link.

### Deploy on each push

The workflow in `.github/workflows/deploy.yml` deploys the backend and the site on each push to `main`. Before it can run, add these secrets to your GitHub repo (Settings > Secrets and variables > Actions):

| Secret | Where to get it |
| --- | --- |
| `CONVEX_DEPLOY_KEY` | The Convex dashboard: your project > Production > Settings > Generate Production Deploy Key |
| `CLOUDFLARE_API_TOKEN` | The Cloudflare dashboard: My Profile > API Tokens > Create Token > the "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | The output of `npx wrangler whoami` |

## Admin commands

Run these in the project folder. JSON arguments go in single quotes. These commands change your dev deployment. To change the production book, add `--prod` after `run`, for example `npx convex run --prod wines:list`.

| To | Run |
| --- | --- |
| Change the title | `npx convex run settings:setTitle '{"title": "…"}'` |
| Check a collection file | `npm run check-wines -- seed/wines.json` |
| Import a collection file | `npm run import-wines -- seed/wines.json` |
| Replace the whole book with a file | `npm run import-wines -- backup.json --replace` |
| Back up the book | `npx convex run wines:exportCollection > backup.json` |
| List the wines in the cellar | `npx convex run wines:list` |
| Add a wine to the cellar | `npx convex run wines:add '{"wine": {…}}'` |
| Change a wine | `npx convex run wines:update '{"wineId": "…", "changes": {"quantity": 1}}'` |
| List the wines in the wild | `npx convex run wild:list` |
| Add a wine in the wild | `npx convex run wild:add '{"wine": {…}}'` |
| Change a wine in the wild | `npx convex run wild:update '{"wildId": "…", "changes": {…}}'` |
| Make a display key | `npx convex run accessKeys:create '{"kind": "display", "name": "Dining room"}'` |
| Make a share link key | `npx convex run accessKeys:create '{"kind": "share", "name": "For Sam"}'` |
| Make a key for the Sommelier | `npx convex run accessKeys:create '{"kind": "owner", "name": "My phone"}'` |
| List the keys | `npx convex run accessKeys:list` |
| Revoke a key | `npx convex run accessKeys:revoke '{"accessKeyId": "…"}'` |

`import-wines` also takes `--prod`. A new key shows only once, when you make it. Convex stores only its hash.

A wine with no bottles left stays in the book, in the archive. To write your own notes about a wine, set its `notes`, for example `{"changes": {"notes": "Opened for Sam’s birthday.\nStill young."}}`. Each `\n` starts a new line.

## The Sommelier

The Sommelier is a page for your phone. Send it a photo or a video of a bottle, a voice note, or a few words. The sommelier, an AI agent, reads the label and updates the book: it adds bottles to the cellar, logs a bottle you opened, or logs a wine you tried somewhere else. A wine with no bottles left moves to the archive. When the sommelier needs to know more, it asks, for example: "Is this for the cellar, or did you try it somewhere?"

The sommelier runs in Convex (`convex/sommelier.ts`). Claude reads the photos and does the thinking, and Deepgram turns the speech in voice notes and videos into text. Set their keys as Convex environment variables. Each command asks for the value:

```bash
npx convex env set ANTHROPIC_API_KEY --prod
npx convex env set DEEPGRAM_API_KEY --prod
```

Leave out `--prod` to set them on your dev deployment. Then make an owner key:

```bash
npx convex run --prod accessKeys:create '{"kind": "owner", "name": "My phone"}'
```

Open `https://<the Worker's address>/sommelier.html?key=<key>` on your phone. On an iPhone, tap Share, then Add to Home Screen, to keep it as an app.

## Add a wine from Claude Code

Claude Code can also add wines, from this folder:

1. Take a photo of the bottle, with the front label facing the camera.
2. Put the photo in `inbox/`, or attach it to a message in Claude Code in this folder.
3. Run `/add-wine`, or say "add this wine".

Claude reads the label, picks the bottle shape and adds the wine through Convex. You can also tell Claude, for example, "I drank a bottle of the Musar" or "I tried this at dinner last night".

## Turn the pages

| To go to | On a tablet or computer | On a phone | Keys |
| --- | --- | --- | --- |
| The next page | Tap › or the right third of the page, or swipe left | Tap ›, or swipe left | → or Page Down |
| The previous page | Tap ‹ or the left third of the page, or swipe right | Tap ‹, or swipe right | ← or Page Up |
| The index and search | Tap the middle of the page | Tap Index | |

The page number is in the address (for example `#5`), so a reload keeps your place.
