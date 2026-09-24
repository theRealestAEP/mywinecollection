---
name: add-wine
description: Add a wine to the book from photos of the bottle, log a wine the user tried somewhere else, or change a wine (bottles bought or drunk, notes, rating). Use it when the user shares a bottle or label photo, puts photos in inbox/, or says they bought, drank or tried a wine.
---

# Add a wine from a photo

The book reads its wines from Convex. Each wine must follow the wine object in `shared/wines.schema.json`; the field descriptions there say what each field means. Convex rejects a wine whose fields have the wrong type or value.

The book keeps two lists:

| List | Holds | Commands |
| --- | --- | --- |
| `wines` | Every wine logged in the cellar. A wine with `quantity` 0 shows in the archive. | `wines:list`, `wines:add`, `wines:update` |
| `wild` | Wine in the wild: wines the user tried somewhere else. These have `tasted` and `where`, and no `quantity`. | `wild:list`, `wild:add`, `wild:update` |

The book on the web reads the production deployment, so each command below has `--prod`. If the user works only on their own computer, and has no production deployment yet, leave `--prod` out.

Commands take JSON in single quotes. Text inside that JSON cannot contain a straight apostrophe ('), so write ’ instead.

## Add a wine

1. Find the photos: images attached to the message, and image files in `inbox/`.
2. Choose the list. A bottle that the user keeps goes in `wines`. A wine that the user tried somewhere else, for example at a restaurant, goes in `wild`. If the message does not make this clear, ask.
3. Read the label and look at the bottle. From the photo, fill in:
   - `producer`, `name`, `vintage`, `region`, `country` and `alcohol`. For a non-vintage wine, set `vintage` to null.
   - `bottle`: the closest of the five shapes that the schema describes.
   - `type`: red, white, rosé, sparkling or fortified.
4. From what you know about this wine and its producer, fill in `grapes`, `window`, `place`, `history`, `contents`, `aromas`, `structure` and `food`.
   - Write short, plain sentences.
   - Write only facts that you are sure of. Leave a field out if you are not sure.
   - Keep each `structure` value, and `rating`, from 1 to 5.
5. If the user tells you something about this wine or bottle, put it in `notes`. Use `\n` for a new line.
6. For a wine in the cellar:
   - Run `npx convex run --prod wines:list`. If the same wine (the same producer, name and vintage) is already there, add the new bottles to its `quantity` with `wines:update`. Do not add it again.
   - Otherwise, add it. Set `quantity` to the number of bottles, or 1 if the user does not say:
     `npx convex run --prod wines:add '{"wine": { … }}'`
7. For a wine in the wild, set `tasted` to the date the user tried it (for example "2026-09-20") and `where` to the place. Then add it:
   `npx convex run --prod wild:add '{"wine": { … }}'`
8. Fix each error that Convex reports, and run the command again.
9. Move each photo from `inbox/` to `photos/`, and name it after the wine, for example `photos/chateau-musar-rouge-2016.jpg`. An image attached to the message has no file to move.
10. Tell the user what you added or changed. List each field that you could not read from the photo.

## Other changes

- Find the wine's ID with `wines:list` or `wild:list`, then change it:
  - `npx convex run --prod wines:update '{"wineId": "<ID>", "changes": { … }}'`
  - `npx convex run --prod wild:update '{"wildId": "<ID>", "changes": { … }}'`
- When the user drank a bottle, subtract 1 from its `quantity`. At 0, the wine moves to the archive. Keep the wine.
- When the user gives a rating, set `rating` (1 to 5).
- An update replaces the whole `notes` text. To add to the notes, first read the old notes with `npx convex run --prod wines:exportCollection`. Then send the old text and the new text together.
- To change the title on the cover, run `npx convex run --prod settings:setTitle '{"title": "…"}'`.
