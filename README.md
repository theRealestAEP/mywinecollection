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

On your phone, the site is an app. You sign in with your email, and the welcome page lists your cellars: each cellar is a book of its own. The app's Sommelier is an AI agent that keeps all your cellars. Send it a photo, a video, a voice note or a few words about a wine. It proposes the wines and bottles to add, logs the bottles you open, and answers questions about your wine. When it needs to know more, it asks.

The pages are made for e-ink tablets, and they also work on phones and computers:

- Each page is a fixed 3:4 sheet, the shape of most e-ink screens.
- All tone comes from hatched lines, with no gradients.
- The page uses three inks that stay clear in greyscale.
- On a phone, the page becomes one column of paper that you scroll. The wine's name and its portrait come first, at a size you can read.
- On a phone or a computer, each new page inks itself in: its drawing appears stroke by stroke, outline first. Then the pen lines "boil": they wobble a little, as in hand-drawn animation.
- On an e-ink tablet, add `&eink` to the end of the link. The page then fills the screen with paper and turns instantly, with no ink-in, because e-ink redraws slowly. The lines still boil; for the smoothest boil, set a fast refresh mode for the browser in the tablet's e-ink settings.
- On other screens, the page keeps still when the device asks for reduced motion.

## How it works

Each person runs their own copy. One Convex deployment holds the cellars of the people on its list, for example you and your family. Each person signs in with their email, and has their own cellars and their own sommelier. Each cellar holds its wines, its wines tried elsewhere, and its drinking log. The site is static, and Cloudflare can host it for free.

There are two ways to open a book:

| Way | For | Notes |
| --- | --- | --- |
| Sign in with your email | Your phone or computer | You see all your cellars, and the Sommelier can change them. |
| A key in the address (`…/?key=…`) | A tablet on the wall (`display`), or a link for friends (`share`) | It opens one cellar, read-only, with no sign-in. You can revoke a key at any time. |

### Sign in

1. On the welcome page, you type your email. The device shows a number.
2. The email brings a link. You can open it on any device, for example in the phone's mail app.
3. The link's page shows the same number. You check it, then tap **Sign in my device**.
4. The device that asked is now signed in.

On an iPhone, a link always opens in Safari, and an app on the home screen does not share its sign-in with Safari. That is why the link signs in the device that asked, wherever you open it. The number shows that the link is for your own device.

A sign-in lasts until you sign out on that device, or your email leaves the list.

The book follows live data: a change in Convex shows on every open screen at once.

## Folders

| Folder | What it holds |
| --- | --- |
| `convex/` | The backend: the schema, the book query, and admin functions |
| `apps/display/` | The book, for e-ink tablets and share links, and the Sommelier page |
| `apps/launcher/` | Cellar, an Android app that shows the book on a wall tablet |
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

3. In a second terminal, put your email on the list, and give the site's address for the sign-in link:

   ```bash
   npx convex env set ALLOWED_EMAILS you@example.com
   npx convex env set SITE_URL http://localhost:5180
   ```

4. Make your first cellar. The command shows the cellar's ID:

   ```bash
   npx convex run cellars:create '{"owner": "you@example.com", "title": "The Cellar"}'
   ```

5. Load the sample wines into it. To start with an empty cellar, skip this step.

   ```bash
   npm run import-wines -- seed/wines.json --cellar <cellar ID>
   ```

6. Start the site, then open `http://localhost:5180` and sign in. Until you set up email (see [Email](#email)), the sign-in link shows in the output of `npx convex dev`.

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

4. Set up sign-in on production. Use the Worker's address for `SITE_URL`, and see [Email](#email) for the email key:

   ```bash
   npx convex env set --prod ALLOWED_EMAILS you@example.com
   npx convex env set --prod SITE_URL https://<the Worker's address>
   npx convex env set --prod RESEND_API_KEY
   ```

5. Make a cellar on production, and copy your wines from a dev cellar into it:

   ```bash
   npx convex run --prod cellars:create '{"owner": "you@example.com", "title": "The Cellar"}'
   npx convex run wines:exportCollection '{"cellarId": "<dev cellar ID>"}' > book.json
   npm run import-wines -- book.json --cellar <production cellar ID> --prod
   ```

6. Open `https://<the Worker's address>` and sign in. On an iPhone, tap Share, then Add to Home Screen, to keep it as an app.

7. For a tablet, make a display key for one cellar, then open `https://<the Worker's address>/?key=<key>`. On an e-ink tablet, add `&eink` to the end of the link.

   ```bash
   npx convex run --prod accessKeys:create '{"cellarId": "<cellar ID>", "kind": "display", "name": "Wall tablet"}'
   ```

### Email

The sign-in email goes out through [Resend](https://resend.com). Make an API key in Resend, then add it to Convex. The command asks for the value:

```bash
npx convex env set --prod RESEND_API_KEY
```

Without a domain of your own, Resend sends from `onboarding@resend.dev`, and only to the email of your Resend account. To sign in other people, add your domain in Resend, then set the sender, for example:

```bash
npx convex env set --prod EMAIL_FROM 'Wine Journal <journal@example.com>'
```

Without `RESEND_API_KEY`, no email goes out, and the sign-in link shows in the Convex logs instead.

### Deploy on each push

The workflow in `.github/workflows/deploy.yml` deploys the backend and the site on each push to `main`. Before it can run, add these secrets to your GitHub repo (Settings > Secrets and variables > Actions):

| Secret | Where to get it |
| --- | --- |
| `CONVEX_DEPLOY_KEY` | The Convex dashboard: your project > Production > Settings > Generate Production Deploy Key |
| `CLOUDFLARE_API_TOKEN` | The Cloudflare dashboard: My Profile > API Tokens > Create Token > the "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | The output of `npx wrangler whoami` |

## Put the book on a wall tablet

`apps/launcher/` holds Cellar, a small Android app for a tablet on the wall. Cellar shows the book full screen and keeps the screen on. It can be the tablet's home app, so the tablet opens the book when it starts.

1. Install a JDK and the Android SDK, with platform `android-35` and the build tools. Then build the app:

   ```bash
   apps/launcher/build.sh
   ```

   The first build makes a signing key, `apps/launcher/launcher.keystore`. Keep this file, because each update must have the same key. Git ignores it.

2. On the tablet, turn on USB debugging. Connect the tablet to your computer, then install the app:

   ```bash
   adb install -r dist/cellar.apk
   ```

3. Open Cellar and paste the link to your book. On an e-ink tablet, the link ends with `&eink`. To type less, tap **Choose the link file** and pick a file that holds the link, such as a text file in Downloads.
4. In the tablet's settings, make Cellar the default home app, for example in Settings > Apps > Default apps > Home app.

If the tablet starts before its Wi-Fi connects, Cellar tries again every 3 seconds. To use another link, clear Cellar's storage in the tablet's settings.

On a BOOX tablet, also do this:

- BOOX freezes new apps, and a frozen app cannot open when the tablet starts. On the Apps screen, tap the snowflake icon, then turn off the switch next to Cellar.

## Admin commands

Run these in the project folder. JSON arguments go in single quotes. These commands change your dev deployment. To change production, add `--prod` after `run`, for example `npx convex run --prod cellars:list`. Most commands take a cellar's ID, from `cellars:list`.

| To | Run |
| --- | --- |
| Let a person sign in | `npx convex env set ALLOWED_EMAILS 'you@example.com,sam@example.com'` |
| List the cellars | `npx convex run cellars:list` |
| Make a cellar | `npx convex run cellars:create '{"owner": "you@example.com", "title": "…"}'` |
| Rename a cellar | `npx convex run cellars:rename '{"cellarId": "…", "title": "…"}'` |
| Give a cellar to another person | `npx convex run cellars:setOwner '{"cellarId": "…", "owner": "sam@example.com"}'` |
| Check a collection file | `npm run check-wines -- seed/wines.json` |
| Import a collection file | `npm run import-wines -- seed/wines.json --cellar <ID>` |
| Replace a cellar's wines with a file | `npm run import-wines -- backup.json --cellar <ID> --replace` |
| Back up a cellar | `npx convex run wines:exportCollection '{"cellarId": "…"}' > backup.json` |
| List a cellar's wines | `npx convex run wines:list '{"cellarId": "…"}'` |
| Add a wine to a cellar | `npx convex run wines:add '{"cellarId": "…", "wine": {…}}'` |
| Change a wine | `npx convex run wines:update '{"wineId": "…", "changes": {"quantity": 1}}'` |
| List a cellar's wines in the wild | `npx convex run wild:list '{"cellarId": "…"}'` |
| Add a wine in the wild | `npx convex run wild:add '{"cellarId": "…", "wine": {…}}'` |
| Change a wine in the wild | `npx convex run wild:update '{"wildId": "…", "changes": {…}}'` |
| Make a display key | `npx convex run accessKeys:create '{"cellarId": "…", "kind": "display", "name": "Dining room"}'` |
| Make a share link key | `npx convex run accessKeys:create '{"cellarId": "…", "kind": "share", "name": "For Sam"}'` |
| List the keys | `npx convex run accessKeys:list` |
| Revoke a key | `npx convex run accessKeys:revoke '{"accessKeyId": "…"}'` |

`import-wines` also takes `--prod`. A new key shows only once, when you make it. Convex stores only its hash.

A wine with no bottles left stays in the book, in the archive. To write your own notes about a wine, set its `notes`, for example `{"changes": {"notes": "Opened for Sam’s birthday.\nStill young."}}`. Each `\n` starts a new line.

## The Sommelier

The Sommelier is the app's chat. Send it a photo of your bottles or your racks, a video, a voice note, or a few words. The sommelier, an AI agent, reads the labels and keeps all your cellars:

- It proposes the wines and bottles to add, and the cellar, and adds them when you agree.
- It logs a bottle you opened, or a wine you tried somewhere else. A wine with no bottles left moves to the archive.
- It answers questions about your wine: what you have, what is ready to drink, what you drank and when, and what to open with a meal.
- It can start and rename cellars.

When it needs to know more, it asks, for example: "Is this for the cellar, or did you try it somewhere?" or "Which cellar?"

The sommelier runs in Convex (`convex/sommelier.ts`). Claude reads the photos and does the thinking, and Deepgram turns the speech in voice notes and videos into text. Set their keys as Convex environment variables. Each command asks for the value:

```bash
npx convex env set ANTHROPIC_API_KEY --prod
npx convex env set DEEPGRAM_API_KEY --prod
```

Leave out `--prod` to set them on your dev deployment. Then sign in on the welcome page, and tap **Sommelier**.

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
