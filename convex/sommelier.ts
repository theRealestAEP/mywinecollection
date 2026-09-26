'use node';

import Anthropic from '@anthropic-ai/sdk';
import type { FunctionReturnType } from 'convex/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';
import { internalAction } from './_generated/server';
import wineSchema from '../shared/wines.schema.json';

// The sommelier: the agent that keeps the book. It reads the owner's messages
// (photos, videos, voice notes and text), asks when something is missing, and
// changes the book through its tools. Deepgram turns speech into text, and
// Claude does the reading and the thinking.
//
// It needs two environment variables in Convex: ANTHROPIC_API_KEY and
// DEEPGRAM_API_KEY.

const MODEL = 'claude-opus-5';

const SYSTEM = `You are the sommelier who keeps a wine journal for its owner. The owner sends you messages about wines: photos of bottles and labels, videos, voice notes and text. You keep the journal up to date with your tools.

The journal holds:
- The cellar: the wines the owner has bottles of, with the number of bottles. A wine with no bottles left stays in the journal, in the archive.
- Wines tried elsewhere: wines the owner tasted at a restaurant, at a friend's house or at a tasting.
- The drinking log: one entry for each bottle the owner opens from the cellar, and for each wine they try elsewhere, with the date.

For each message:
1. Work out what the owner wants: add bottles to the cellar, log a bottle they opened, log a wine they tried elsewhere, or change a wine.
2. If you cannot tell, or you need a detail that the owner did not give, ask one short question and change nothing yet. For example: is this wine for the cellar, or did you try it somewhere? How many bottles? Which of these two wines?
3. Before you add a wine, look for it with find_wines. The same producer, name and vintage is the same wine: add bottles to it or log it, and do not add it again.
4. For a new wine, read the label: producer, name, vintage, region, country and alcohol. For a non-vintage wine, the vintage is null. Pick the closest bottle shape. From what you know about the wine and its producer, fill in grapes, window, place, history, contents, aromas, structure and food. Write short, plain sentences. Leave out a field that you are not sure of.
5. What the owner says about the wine itself goes in the wine's notes, in their words. What they say about one bottle, such as who they drank it with or how it tasted that night, goes in the notes of that log entry.
6. For the log, use the date on the owner's message, unless they name another day.
7. If a tool reports an error, fix the input and try again.
8. When you are done, reply in one or two short sentences that say what you changed.

Write plainly, like a friend who knows wine. Do not use lists or headings.`;

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

const tools: Anthropic.Tool[] = [
  {
    name: 'find_wines',
    description: 'Finds wines in the journal, in the cellar or tried elsewhere, whose producer, name, vintage or region hold every word of the query. Returns each wine with its id. An empty query lists every wine.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'add_to_cellar',
    description: 'Adds a new wine to the cellar, with its number of bottles. Look for it with find_wines first.',
    input_schema: { type: 'object', properties: { wine, bottles: { type: 'integer', minimum: 1 } }, required: ['wine', 'bottles'] },
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
    description: "Logs a wine that the owner tried somewhere else, such as at a restaurant or a friend's house. Give wine_id for a wine that is already in the journal, or else give the wine to add it.",
    input_schema: { type: 'object', properties: { wine_id: { type: 'string' }, wine, ...logEntry }, required: ['date'] },
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
  args: {},
  handler: async (ctx) => {
    // Answer the waiting messages, then look again: more may have come in.
    for (;;) {
      const read = await ctx.runMutation(internal.journal.takeWaiting, {});
      if (!read.length) return;
      try {
        const talk = await ctx.runQuery(internal.journal.recentTalk, {});
        await transcribe(ctx, talk);
        const text = await converse(ctx, talk);
        await ctx.runMutation(internal.journal.reply, { text, read, failed: false });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await ctx.runMutation(internal.journal.reply, { text: `Something went wrong, and I changed nothing more. (${reason})`, read, failed: true });
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
async function converse(ctx: ActionCtx, talk: Talk): Promise<string> {
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
        results.push({ type: 'tool_result', tool_use_id: call.id, content: await runTool(ctx, call.name, call.input) });
      } catch (error) {
        results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: error instanceof Error ? error.message : String(error) });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  throw new Error('The sommelier took too many steps.');
}

// Runs one tool. Convex checks each input against the schema, and an error
// goes back to Claude to fix.
async function runTool(ctx: ActionCtx, name: string, input: unknown): Promise<string> {
  // Claude's input follows the tool's schema; Convex checks it again.
  const args = input as Record<string, any>;
  switch (name) {
    case 'find_wines':
      return JSON.stringify(await ctx.runQuery(internal.journal.findWines, { query: args.query }));
    case 'add_to_cellar':
      return ctx.runMutation(internal.journal.addToCellar, { wine: args.wine, bottles: args.bottles });
    case 'add_bottles':
      return ctx.runMutation(internal.journal.addBottles, { wineId: args.wine_id as Id<'wines'>, bottles: args.bottles });
    case 'open_bottle':
      return ctx.runMutation(internal.journal.openBottle, { wineId: args.wine_id as Id<'wines'>, date: args.date, where: args.where, notes: args.notes });
    case 'log_tried_wine':
      return ctx.runMutation(internal.journal.logTried, { wineId: args.wine_id, wine: args.wine, date: args.date, where: args.where, notes: args.notes });
    case 'update_wine':
      return ctx.runMutation(internal.journal.updateWine, { wineId: args.wine_id, changes: args.changes });
    default:
      throw new Error(`There is no tool named ${name}.`);
  }
}
