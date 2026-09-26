// Sommelier: the owner's page for talking to the sommelier, the agent that
// keeps the book (convex/sommelier.ts). Send a photo or a video of a bottle,
// a voice note, or a few words. The sommelier adds the wine, logs the bottle
// you opened, or asks what it needs to know. The page needs an owner key in
// its address (?key=…).

import { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { escapeHtml } from '../../../shared/draw';
import './sommelier.css';

type Talk = FunctionReturnType<typeof api.journal.talk>;
type Kind = 'image' | 'audio' | 'video';
interface Attachment {
  kind: Kind;
  blob: Blob;
  label: string;
  preview?: string;
}

// Photos go up at most this many pixels on their long edge: Claude reads no
// finer than this.
const LONG_EDGE = 1568;

const key = new URLSearchParams(location.search).get('key') ?? '';
const client = new ConvexClient(import.meta.env.VITE_CONVEX_URL);
const app = document.getElementById('app') as HTMLElement;
const attachments: Attachment[] = [];
let recorder: MediaRecorder | undefined;
let recordingSince = 0;
let sending = false;

app.innerHTML = `
  <header class="top">
    <h1>Sommelier</h1>
    <a href="/?key=${encodeURIComponent(key)}">Open the journal</a>
  </header>
  <ol class="talk"></ol>
  <form class="composer">
    <ul class="attachments"></ul>
    <div class="row">
      <label class="tool">Photo<input type="file" accept="image/*,video/*" multiple hidden /></label>
      <button type="button" class="tool voice">Voice</button>
      <textarea rows="1" placeholder="Tell me about a wine"></textarea>
      <button class="send">Send</button>
    </div>
  </form>`;

const talkList = app.querySelector('.talk') as HTMLOListElement;
const form = app.querySelector('.composer') as HTMLFormElement;
const attachmentList = app.querySelector('.attachments') as HTMLUListElement;
const fileInput = app.querySelector('input[type=file]') as HTMLInputElement;
const voiceButton = app.querySelector('.voice') as HTMLButtonElement;
const textBox = app.querySelector('textarea') as HTMLTextAreaElement;
const sendButton = app.querySelector('.send') as HTMLButtonElement;

// ---- The talk ----------------------------------------------------------------

const FILE_LABELS: Record<Kind, string> = { image: 'Photo', audio: 'Voice note', video: 'Video' };
const STATUS: Record<string, string> = { waiting: 'Sent', reading: 'Reading…', failed: 'Not read' };

function showTalk(talk: Talk) {
  const intro = `<li class="from-sommelier"><p>Send me a photo or a video of a bottle, a voice note, or a few words. I’ll add the wine to your journal, or log the bottle you opened.</p></li>`;
  const items = talk.map((message) => {
    if (message.from === 'sommelier') return `<li class="from-sommelier"><p>${escapeHtml(message.text)}</p></li>`;
    const photos = message.files
      .filter((file) => file.kind === 'image')
      .map((file) => `<img src="${escapeHtml(file.url)}" alt="" />`)
      .join('');
    const sounds = message.files
      .filter((file) => file.kind !== 'image')
      .map((file) => `<span class="chip">${FILE_LABELS[file.kind]}</span>`)
      .join('');
    const status = message.status && STATUS[message.status] ? `<span class="status">${STATUS[message.status]}</span>` : '';
    return `
      <li class="from-owner">
        ${photos ? `<div class="photos">${photos}</div>` : ''}
        ${sounds}
        ${message.text ? `<p>${escapeHtml(message.text)}</p>` : ''}
        ${status}
      </li>`;
  });
  talkList.innerHTML = intro + items.join('');
  scrollTo(0, document.documentElement.scrollHeight);
}

function showProblem(text: string) {
  talkList.innerHTML = `<li class="from-sommelier"><p>${escapeHtml(text)}</p></li>`;
}

// ---- What you are about to send ----------------------------------------------

function showAttachments() {
  attachmentList.innerHTML = attachments
    .map(
      (attachment, i) => `
        <li>
          ${attachment.preview ? `<img src="${attachment.preview}" alt="" />` : ''}
          <span>${attachment.label}</span>
          <button type="button" data-remove="${i}" aria-label="Remove">×</button>
        </li>`,
    )
    .join('');
}

attachmentList.addEventListener('click', (event) => {
  const index = (event.target as HTMLElement).dataset.remove;
  if (index === undefined) return;
  attachments.splice(Number(index), 1);
  showAttachments();
});

fileInput.addEventListener('change', () => {
  for (const file of fileInput.files ?? []) {
    const kind = file.type.startsWith('video/') ? 'video' : 'image';
    attachments.push({ kind, blob: file, label: FILE_LABELS[kind], preview: kind === 'image' ? URL.createObjectURL(file) : undefined });
  }
  fileInput.value = '';
  showAttachments();
});

// Tap Voice to start recording, and again to stop.
voiceButton.addEventListener('click', async () => {
  if (recorder) {
    recorder.stop();
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks: Blob[] = [];
  recorder = new MediaRecorder(stream);
  recorder.addEventListener('dataavailable', (event) => chunks.push(event.data));
  recorder.addEventListener('stop', () => {
    stream.getTracks().forEach((track) => track.stop());
    const seconds = Math.round((Date.now() - recordingSince) / 1000);
    attachments.push({ kind: 'audio', blob: new Blob(chunks, { type: recorder?.mimeType }), label: `Voice note, ${seconds} s` });
    recorder = undefined;
    voiceButton.textContent = 'Voice';
    voiceButton.classList.remove('recording');
    showAttachments();
  });
  recorder.start();
  recordingSince = Date.now();
  voiceButton.textContent = 'Stop';
  voiceButton.classList.add('recording');
});

// The box grows with what you write, up to a few lines.
textBox.addEventListener('input', () => {
  textBox.style.height = 'auto';
  textBox.style.height = `${textBox.scrollHeight}px`;
});

// ---- Sending -------------------------------------------------------------------

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = textBox.value.trim();
  if (sending || recorder || (!text && !attachments.length)) return;
  sending = true;
  sendButton.textContent = 'Sending…';
  try {
    const files: { storageId: Id<'_storage'>; kind: Kind }[] = [];
    for (const attachment of attachments) {
      if (attachment.kind === 'image') {
        files.push({ storageId: await upload(await photoToJpeg(attachment.blob)), kind: 'image' });
      } else if (attachment.kind === 'video') {
        // Claude sees the video as three stills; Deepgram hears the video itself.
        for (const frame of await videoStills(attachment.blob)) files.push({ storageId: await upload(frame), kind: 'image' });
        files.push({ storageId: await upload(attachment.blob), kind: 'video' });
      } else {
        files.push({ storageId: await upload(attachment.blob), kind: 'audio' });
      }
    }
    // The owner's own date, YYYY-MM-DD, for the drinking log.
    const date = new Date().toLocaleDateString('en-CA');
    await client.mutation(api.journal.send, { key, text, date, files });
    attachments.length = 0;
    showAttachments();
    textBox.value = '';
    textBox.style.height = 'auto';
  } catch (error) {
    alert(`The message did not send: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    sending = false;
    sendButton.textContent = 'Send';
  }
});

// Uploads a file to Convex, and returns its id.
async function upload(blob: Blob): Promise<Id<'_storage'>> {
  const url = await client.mutation(api.journal.uploadUrl, { key });
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
  if (!response.ok) throw new Error(`upload failed (${response.status})`);
  return (await response.json()).storageId;
}

// A photo as a JPEG no larger than LONG_EDGE. This also turns an iPhone's
// HEIC photos into a format that Claude reads.
async function photoToJpeg(photo: Blob): Promise<Blob> {
  const url = URL.createObjectURL(photo);
  const image = new Image();
  image.src = url;
  await image.decode();
  const jpeg = await drawJpeg(image, image.naturalWidth, image.naturalHeight);
  URL.revokeObjectURL(url);
  return jpeg;
}

// Three stills from a video: at a fifth, half and four fifths of the way through.
async function videoStills(video: Blob): Promise<Blob[]> {
  const player = document.createElement('video');
  player.muted = true;
  player.playsInline = true;
  player.preload = 'auto';
  player.src = URL.createObjectURL(video);
  await new Promise((resolve) => player.addEventListener('loadeddata', resolve, { once: true }));
  const stills: Blob[] = [];
  for (const at of [0.2, 0.5, 0.8]) {
    player.currentTime = player.duration * at;
    await new Promise((resolve) => player.addEventListener('seeked', resolve, { once: true }));
    stills.push(await drawJpeg(player, player.videoWidth, player.videoHeight));
  }
  URL.revokeObjectURL(player.src);
  return stills;
}

function drawJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const scale = Math.min(1, LONG_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not read the image'))), 'image/jpeg', 0.85));
}

// ---- Start -----------------------------------------------------------------------

if (!key) {
  showProblem('This page needs the Sommelier link, with its key in the address.');
} else {
  client.onUpdate(api.journal.talk, { key }, showTalk, (error) => showProblem(error.message));
}
