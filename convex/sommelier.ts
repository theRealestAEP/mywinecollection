'use node';

import Anthropic from '@anthropic-ai/sdk';
import type { FunctionReturnType } from 'convex/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';
import { internalAction } from './_generated/server';
import wineSchema from '../shared/wines.schema.json';

// The sommelier: each person's agent. It keeps all of that person's cellars,
// and it answers questions about them. It reads the owner's messages (photos,
// videos, voice notes and text), asks when something is missing, and changes
// the cellars through its tools. Deepgram turns speech into text, and Claude
// does the reading and the thinking.
//
// It needs two environment variables in Convex: ANTHROPIC_API_KEY and
// DEEPGRAM_API_KEY.

const MODEL = 'claude-opus-5';

const SYSTEM = `You are the owner's sommelier. You keep their wine journal, and you answer their questions about their wine. The owner sends you messages: photos of bottles, labels, cases and racks, videos, voice notes and text. Each message starts with the date the owner sent it.

The journal holds one or more cellars. Each cellar is a book with:
- Its wines, with the number of bottles. A wine with no bottles left stays in the cellar's book, in the archive.
- Wines tried elsewhere: wines the owner tasted at a restaurant, at a friend's house or at a tasting.
- Its drinking log: one entry for each bottle opened from the cellar, and for each wine tried elsewhere, with the date.

When the owner asks to change the journal:
1. Work out what they want: add bottles, log a bottle they opened, log a wine they tried elsewhere, change a wine, or start or rename a cellar.
2. Work out which cellar. Call list_cellars. If there is one cellar, use it. If there are more and the message does not make it clear, ask which one. If there are none, ask what to call their first cellar, and make it with create_cellar.
3. If you cannot tell what they want, or you need a detail that they did not give, ask one short question and change nothing yet. For example: is this wine for the cellar, or did you try it somewhere? How many bottles? Which of these two wines?
4. Before you add a wine, look for it with find_wines. The same producer, name and vintage in the same cellar is the same wine: add bottles to it or log it, and do not add it again.
5. Before you add wines or bottles, propose what you will add: each wine, how many bottles, and which cellar. Then wait for the owner to agree or correct you. Count the bottles in a photo with care, and say when you are not sure of a count. When the owner agrees, add them.
6. For a new wine, read the label: producer, name, vintage, region, country and alcohol. For a non-vintage wine, the vintage is null. Pick the closest bottle shape. From what you know about the wine and its producer, fill in grapes, window, place, history, contents, aromas, structure and food. Write short, plain sentences. Leave out a field that you are not sure of.
7. What the owner says about the wine itself goes in the wine's notes, in their words. What they say about one bottle, such as who they drank it with or how it tasted that night, goes in the notes of that log entry.
8. For the log, use the date on the owner's message, unless they name another day.
9. If a tool reports an error, fix the input and try again.
10. When you are done, say in a sentence or two what you changed.

When the owner asks about their wine, look it up with find_wines, get_wine and read_log, and answer from what you find: what they have, where it is, what is ready to drink, what they drank and when, and what to open with a meal.

Write plainly, like a friend who knows wine. Keep replies short. Do not use headings or Markdown.`;

// The wine object from shared/wines.schema.json: the fields of a wine's page,
// without the bottle count or the tasting. The tools take it as their input.
const { quantity, tasted, where, ...wineProperties } = wineSchema.definitions.wine.properties;
const level = wineSchema.definitions.level;
const wine = {
  ...wineSchema.definitions.wine,
  properties: {
    ...wineProperties,
    structure: {
      ...wineProperties.structure,
      properties: { sweetness: level, acidity: level, tannin: level, body: level, finish: level },
    },
  },
};

const date = { type: 'string', description: 'YYYY-MM-DD' };
const logEntry = {
  date,
  where: { type: 'string', description: 'Where the owner drank it, if they said.' },
  notes: { type: 'string', description: 'What the owner said about this bottle or this tasting.' },
};

const cellarId = { type: 'string', description: "The id of one of the owner's cellars, from list_cellars." };

const tools: Anthropic.Tool[] = [
  {
    name: 'list_cellars',
    description: "Lists the owner's cellars, with the id, the title, and the number of wines and bottles in each.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_cellar',
    description: 'Starts a new, empty cellar with this title. Make one only when the owner asks for it, or agrees to it.',
    input_schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  },
  {
    name: 'rename_cellar',
    description: "Changes a cellar's title, the name on its book's cover.",
    input_schema: { type: 'object', properties: { cellar_id: cellarId, title: { type: 'string' } }, required: ['cellar_id', 'title'] },
  },
  {
    name: 'find_wines',
    description: "Finds wines in the owner's cellars whose fields hold every word of the query: producer, name, vintage, region, country, grapes, style, aromas, food, notes, or where it was tried. Searches every cellar, or one cellar if you give cellar_id. Returns each wine with its id, its cellar, and its list: cellar (with bottles), archive (none left), or tried elsewhere. An empty query lists every wine.",
    input_schema: { type: 'object', properties: { query: { type: 'string' }, cellar_id: cellarId }, required: ['query'] },
  },
  {
    name: 'get_wine',
    description: 'Gets everything about one wine: all its fields, its cellar, and its entries in the drinking log.',
    input_schema: { type: 'object', properties: { wine_id: { type: 'string' } }, required: ['wine_id'] },
  },
  {
    name: 'read_log',
    description: 'Reads the drinking log, newest first: in every cellar, or in one cellar if you give cellar_id. Give from and to (YYYY-MM-DD) for a span of dates. Returns at most 100 entries.',
    input_schema: { type: 'object', properties: { cellar_id: cellarId, from: date, to: date } },
  },
  {
    name: 'add_to_cellar',
    description: 'Adds a new wine to a cellar, with its number of bottles. Look for it with find_wines first, and propose it to the owner before you add it.',
    input_schema: { type: 'object', properties: { cellar_id: cellarId, wine, bottles: { type: 'integer', minimum: 1 } }, required: ['cellar_id', 'wine', 'bottles'] },
  },
  {
    name: 'add_bottles',
    description: 'Adds bottles to a wine that is already in the cellar.',
    input_schema: { type: 'object', properties: { wine_id: { type: 'string' }, bottles: { type: 'integer', minimum: 1 } }, required: ['wine_id', 'bottles'] },
  },
  {
    name: 'open_bottle',
    description: 'Logs a bottle from the cellar that the owner opened or drank. It takes one bottle off the count and adds an entry to the drinking log. A wine with no bottles left moves to the archive.',
    input_schema: { type: 'object', properties: { wine_id: { type: 'string' }, ...logEntry }, required: ['wine_id', 'date'] },
  },
  {
    name: 'log_tried_wine',
    description: "Logs a wine that the owner tried somewhere else, such as at a restaurant or a friend's house. Give wine_id for a wine that is already in the journal. Or else give the wine, and the cellar_id of the book to log it in.",
    input_schema: { type: 'object', properties: { wine_id: { type: 'string' }, cellar_id: cellarId, wine, ...logEntry }, required: ['date'] },
  },
  {
    name: 'update_wine',
    description: "Changes fields of a wine in the journal: to correct a detail, set the rating, set a cellar wine's number of bottles (quantity), or set the owner's notes. The notes replace the old notes, so keep the old text that should stay.",
    input_schema: {
      type: 'object',
      properties: { wine_id: { type: 'string' }, changes: { type: 'object', description: 'The fields to change, with their new values.' } },
      required: ['wine_id', 'changes'],
    },
  },
];

type Talk = FunctionReturnType<typeof internal.journal.recentTalk>;

export const respond = internalAction({
  args: { owner: v.string() },
  handler: async (ctx, { owner }) => {
    // Answer the waiting messages, then look again: more may have come in.
    for (;;) {
      const read = await ctx.runMutation(internal.journal.takeWaiting, { owner });
      if (!read.length) return;
      try {
        const talk = await ctx.runQuery(internal.journal.recentTalk, { owner });
        await transcribe(ctx, talk);
        const text = await converse(ctx, owner, talk);
        await ctx.runMutation(internal.journal.reply, { owner, text, read, failed: false });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await ctx.runMutation(internal.journal.reply, { owner, text: `Something went wrong, and I changed nothing more. (${reason})`, read, failed: true });
      }
    }
  },
});

// Turns the speech in new voice notes and videos into text, with Deepgram.
async function transcribe(ctx: ActionCtx, talk: Talk) {
  for (const message of talk) {
    const sounds = message.files.filter((each) => each.kind !== 'image');
    if (message.transcript !== undefined || !sounds.length) continue;
    const parts = await Promise.all(sounds.map((each) => deepgram(each.url)));
    message.transcript = parts.join('\n');
    await ctx.runMutation(internal.journal.setTranscript, { messageId: message._id, transcript: message.transcript });
  }
}

async function deepgram(url: string): Promise<string> {
  const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true', {
    method: 'POST',
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) throw new Error(`Deepgram could not hear the recording: ${response.status} ${await response.text()}`);
  const result = await response.json();
  return result.results.channels[0].alternatives[0].transcript;
}

// Asks Claude to answer the talk, and runs the tools it calls. Returns the
// reply to show the owner.
async function converse(ctx: ActionCtx, owner: string, talk: Talk): Promise<string> {
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [];
  for (const message of talk) {
    if (message.from === 'sommelier') {
      // The talk must start with the owner.
      if (messages.length) messages.push({ role: 'assistant', content: message.text });
      continue;
    }
    const content: Anthropic.ContentBlockParam[] = message.files
      .filter((each) => each.kind === 'image')
      .map((each) => ({ type: 'image', source: { type: 'url', url: each.url } }));
    const lines = [`(Sent ${message.date})`, message.text];
    if (message.transcript) lines.push(`Spoken in a voice note or video: ${message.transcript}`);
    content.push({ type: 'text', text: lines.filter(Boolean).join('\n') });
    messages.push({ role: 'user', content });
  }

  // Each turn, Claude answers or calls tools. A dozen turns is plenty.
  for (let turn = 0; turn < 12; turn++) {
    const response = await client.messages.create({ model: MODEL, max_tokens: 16000, system: SYSTEM, tools, messages });
    const calls = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !calls.length) {
      const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n').trim();
      return text || 'Done.';
    }
    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      try {
        results.push({ type: 'tool_result', tool_use_id: call.id, content: await runTool(ctx, owner, call.name, call.input) });
      } catch (error) {
        results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: error instanceof Error ? error.message : String(error) });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  throw new Error('The sommelier took too many steps.');
}

// Runs one tool for the owner. Convex checks each input against the schema,
// and each function checks that the cellar or wine is the owner's. An error
// goes back to Claude to fix.
async function runTool(ctx: ActionCtx, owner: string, name: string, input: unknown): Promise<string> {
  // Claude's input follows the tool's schema; Convex checks it again.
  const args = input as Record<string, any>;
  const cellarId = args.cellar_id as Id<'cellars'> | undefined;
  switch (name) {
    case 'list_cellars':
      return JSON.stringify(await ctx.runQuery(internal.journal.listCellars, { owner }));
    case 'create_cellar':
      return ctx.runMutation(internal.journal.createCellar, { owner, title: args.title });
    case 'rename_cellar':
      return ctx.runMutation(internal.journal.renameCellar, { owner, cellarId: args.cellar_id, title: args.title });
    case 'find_wines':
      return JSON.stringify(await ctx.runQuery(internal.journal.findWines, { owner, query: args.query, cellarId }));
    case 'get_wine':
      return JSON.stringify(await ctx.runQuery(internal.journal.getWine, { owner, wineId: args.wine_id }));
    case 'read_log':
      return JSON.stringify(await ctx.runQuery(internal.journal.readLog, { owner, cellarId, from: args.from, to: args.to }));
    case 'add_to_cellar':
      return ctx.runMutation(internal.journal.addToCellar, { owner, cellarId: args.cellar_id, wine: args.wine, bottles: args.bottles });
    case 'add_bottles':
      return ctx.runMutation(internal.journal.addBottles, { owner, wineId: args.wine_id as Id<'wines'>, bottles: args.bottles });
    case 'open_bottle':
      return ctx.runMutation(internal.journal.openBottle, { owner, wineId: args.wine_id as Id<'wines'>, date: args.date, where: args.where, notes: args.notes });
    case 'log_tried_wine':
      return ctx.runMutation(internal.journal.logTried, { owner, cellarId, wineId: args.wine_id, wine: args.wine, date: args.date, where: args.where, notes: args.notes });
    case 'update_wine':
      return ctx.runMutation(internal.journal.updateWine, { owner, wineId: args.wine_id, changes: args.changes });
    default:
      throw new Error(`There is no tool named ${name}.`);
  }
}
