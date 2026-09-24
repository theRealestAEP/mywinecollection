# Wine Portraits

A drawn book of your wine cellar, made for e-ink tablets. Each wine gets a page with:

- a pen-and-ink drawing of its bottle, with notes in the margin
- its style, aromas, food pairing and rating
- where it is made, its history, and what is in it
- a drinking-window timeline
- a chart of its structure: sweetness, acidity, tannin, body and finish

Your own notes about a wine take the place of the written sections about it.

The index has a search box. A search finds the wines that have every word you type, in any field or in your notes. It ignores case and accents, so "rose" finds "Rosé".

The book has three sections:

| Section | Holds |
| --- | --- |
| In the cellar | The wines you have bottles of |
| Archive | Every wine you logged in the cellar that has no bottles left |
| In the wild | Wines you tried somewhere else, with when and where |

The pages are made for e-ink tablets:

- Each page is a fixed 3:4 sheet, the shape of most e-ink screens.
- All tone comes from hatched lines, with no gradients.
- The page uses three inks that stay clear in greyscale.
- Pages turn instantly, with no animation.
- The pen lines stay still on touch screens. On a computer with a mouse, the lines "boil": they wobble a little, as in hand-drawn animation. The lines also stay still when the device asks for reduced motion.

## How it works

Each person runs their own copy. One Convex deployment holds one book: its title, its wines and its access keys. The site is static, and Cloudflare can host it for free.

A screen opens the book with an access key in its address (`…/?key=…`). A key can only read the book. There are two kinds:

| Kind | For | Notes |
| --- | --- | --- |
| `display` | A tablet in your home | |
| `share` | A view-only link for friends | You can revoke it at any time. |

The book follows live data: a change in Convex shows on every open screen at once.

## Folders

| Folder | What it holds |
| --- | --- |
| `convex/` | The backend: the schema, the book query, and admin functions |
| `apps/display/` | The book, for e-ink tablets and share links |
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

6. Open `https://<the Worker's address>/?key=<key>`.

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
| List the keys | `npx convex run accessKeys:list` |
| Revoke a key | `npx convex run accessKeys:revoke '{"accessKeyId": "…"}'` |

`import-wines` also takes `--prod`. A new key shows only once, when you make it. Convex stores only its hash.

A wine with no bottles left stays in the book, in the archive. To write your own notes about a wine, set its `notes`, for example `{"changes": {"notes": "Opened for Sam’s birthday.\nStill young."}}`. Each `\n` starts a new line.

## Add a wine from a photo

Until there is a phone app, Claude Code adds wines:

1. Take a photo of the bottle, with the front label facing the camera.
2. Put the photo in `inbox/`, or attach it to a message in Claude Code in this folder.
3. Run `/add-wine`, or say "add this wine".

Claude reads the label, picks the bottle shape and adds the wine through Convex. You can also tell Claude, for example, "I drank a bottle of the Musar" or "I tried this at dinner last night".

## Turn the pages

| To go to | Tap | Swipe | Or press |
| --- | --- | --- | --- |
| The next page | › or the right third of the screen | Left | → or Page Down |
| The previous page | ‹ or the left third of the screen | Right | ← or Page Up |
| The index and search | The middle of the screen | | |

The page number is in the address (for example `#5`), so a reload keeps your place.
