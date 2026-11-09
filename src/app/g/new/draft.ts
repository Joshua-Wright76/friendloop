import type { Participation } from "@/components/invite-participation";
import type { MarksDraft } from "@/components/mark-pickers";
import type { StationeryLooks } from "@/components/paper-fields";

/**
 * A loop being set up is kept on the device as it's made, so an interruption (a
 * call, a reload, a phone that drops the tab while someone fetches an address
 * from their contacts) never sends them back to an empty first step.
 */
export type LoopDraft = {
  step: number;
  name: string;
  cadence: string;
  weekday: string;
  hour: string;
  timezone: string;
  picked: string[];
  customQuestions: string[];
  pickedIdeas: string[];
  emails: string[];
  participation: Participation;
  personalNote: string;
  preset: string;
  accent: string;
  looks: StationeryLooks;
  /** The motto, sign-off, seal, divider and celebration. */
  marks: MarksDraft;
  hasPicture: boolean;
};

const VERSION = 1;
/** Long enough to come back after a busy week; not so long a stale one surprises. */
const KEEP_FOR_MS = 30 * 24 * 60 * 60 * 1000;

// Per person, so two people on one shared device never see each other's loop.
const draftKey = (userId: string) => `friendloop-new-loop:${userId}`;

export function keepDraft(userId: string, draft: LoopDraft) {
  try {
    localStorage.setItem(draftKey(userId), JSON.stringify({ v: VERSION, at: Date.now(), draft }));
  } catch { /* Private mode or a full store: the wizard still works, it just isn't kept. */ }
}

export function recallDraft(userId: string, fallback: LoopDraft): LoopDraft | null {
  let saved: unknown;
  try {
    const raw = localStorage.getItem(draftKey(userId));
    if (!raw) return null;
    saved = JSON.parse(raw);
  } catch {
    return null;
  }
  const { v, at, draft } = (saved ?? {}) as { v?: unknown; at?: unknown; draft?: unknown };
  if (v !== VERSION || typeof at !== "number" || Date.now() - at > KEEP_FOR_MS || !draft || typeof draft !== "object") {
    forgetDraft(userId);
    return null;
  }
  return mergeDraft(fallback, draft as Record<string, unknown>);
}

export function forgetDraft(userId: string) {
  try { localStorage.removeItem(draftKey(userId)); } catch { /* Nothing kept. */ }
  void forgetPicture(userId);
}

/** Whatever was kept and still makes sense; anything odd falls back to the fresh value. */
export function mergeDraft(fallback: LoopDraft, saved: Record<string, unknown>): LoopDraft {
  const string = (key: keyof LoopDraft) => (typeof saved[key] === "string" ? (saved[key] as string) : (fallback[key] as string));
  const strings = (key: keyof LoopDraft) => Array.isArray(saved[key]) && (saved[key] as unknown[]).every((item) => typeof item === "string")
    ? (saved[key] as string[])
    : (fallback[key] as string[]);
  const looks = (saved.looks && typeof saved.looks === "object" ? saved.looks : {}) as Record<string, unknown>;
  const look = (key: keyof StationeryLooks) => (typeof looks[key] === "string" ? (looks[key] as string) : fallback.looks[key]);
  const marks = (saved.marks && typeof saved.marks === "object" ? saved.marks : {}) as Record<string, unknown>;
  const mark = (key: keyof MarksDraft) => (typeof marks[key] === "string" ? (marks[key] as string) : fallback.marks[key]);
  return {
    step: Number.isInteger(saved.step) ? (saved.step as number) : fallback.step,
    name: string("name"),
    cadence: string("cadence"),
    weekday: string("weekday"),
    hour: string("hour"),
    timezone: string("timezone"),
    picked: strings("picked"),
    customQuestions: strings("customQuestions"),
    pickedIdeas: strings("pickedIdeas"),
    emails: strings("emails"),
    participation: saved.participation === "reader" ? "reader" : saved.participation === "contributor" ? "contributor" : fallback.participation,
    personalNote: string("personalNote"),
    preset: string("preset"),
    accent: string("accent"),
    looks: {
      background: look("background"),
      paperPack: look("paperPack"),
      tapePack: look("tapePack"),
      mascot: look("mascot"),
    },
    marks: {
      motto: mark("motto"),
      signOff: mark("signOff"),
      sealStyle: mark("sealStyle"),
      sealColor: mark("sealColor"),
      divider: mark("divider"),
      celebration: mark("celebration"),
    },
    hasPicture: saved.hasPicture === true,
  };
}

/** True once the person has chosen or typed anything worth coming back to. */
export function draftIsWorthKeeping(draft: LoopDraft, fresh: LoopDraft): boolean {
  // The zone fills itself in from the browser, so it alone isn't a choice.
  const choices = (value: LoopDraft) => JSON.stringify({ ...value, step: 0, timezone: "" });
  return draft.step > 0 || choices(draft) !== choices(fresh);
}

// The header picture is a file, which localStorage can't hold, so it waits in IndexedDB,
// as its bytes: Safari's private windows refuse to store a Blob there, but not bytes.
const DB_NAME = "friendloop-drafts";
const STORE = "pictures";

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, ask: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await openStore();
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = ask(transaction.objectStore(STORE));
      transaction.oncomplete = () => { db.close(); resolve(request.result); };
      transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error); };
    });
  } catch {
    return undefined;
  }
}

type KeptPicture = { bytes: ArrayBuffer; name: string; type: string };

export async function keepPicture(userId: string, file: File) {
  const kept: KeptPicture = { bytes: await file.arrayBuffer(), name: file.name, type: file.type };
  await withStore("readwrite", (store) => store.put(kept, userId));
}

export async function recallPicture(userId: string): Promise<File | null> {
  const kept = await withStore<unknown>("readonly", (store) => store.get(userId));
  // A picture kept before it went in as bytes is still a Blob.
  if (kept instanceof Blob) return new File([kept], (kept as File).name || "header", { type: kept.type });
  if (!kept || typeof kept !== "object" || !((kept as KeptPicture).bytes instanceof ArrayBuffer)) return null;
  const { bytes, name, type } = kept as KeptPicture;
  return new File([bytes], name || "header", { type });
}

export async function forgetPicture(userId: string) {
  await withStore("readwrite", (store) => store.delete(userId));
}
