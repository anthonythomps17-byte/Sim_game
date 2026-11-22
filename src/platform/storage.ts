// Save slots in IndexedDB, plus small per-device settings in localStorage.
const DB = 'ashton-life';
const STORE = 'saves';

export type SlotId = 'auto' | 'slot1' | 'slot2' | 'slot3';
export const SLOTS: SlotId[] = ['auto', 'slot1', 'slot2', 'slot3'];

export interface SlotMeta { slot: SlotId; household: string; day: number; funds: number; savedAt: string }
interface Row { slot: SlotId; meta: SlotMeta; data: string }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'slot' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export async function saveSlot(slot: SlotId, meta: Omit<SlotMeta, 'slot' | 'savedAt'>, data: string): Promise<void> {
  const row: Row = { slot, meta: { ...meta, slot, savedAt: new Date().toISOString() }, data };
  await tx('readwrite', (s) => s.put(row));
}

export async function loadSlot(slot: SlotId): Promise<string | null> {
  const row = await tx<Row | undefined>('readonly', (s) => s.get(slot));
  return row?.data ?? null;
}

export async function deleteSlot(slot: SlotId): Promise<void> {
  await tx('readwrite', (s) => s.delete(slot));
}

export async function listSlots(): Promise<SlotMeta[]> {
  try {
    const rows = await tx<Row[]>('readonly', (s) => s.getAll());
    return rows.map((r) => r.meta);
  } catch {
    return [];
  }
}

export interface DeviceSettings { quality: 'low' | 'medium' | 'high'; music: number; sfx: number; wallMode: 'up' | 'cutaway' | 'down'; seenTutorial: boolean; skipSleep: boolean }

const DEFAULTS: DeviceSettings = { quality: 'medium', music: 0.4, sfx: 0.7, wallMode: 'cutaway', seenTutorial: false, skipSleep: false };

export function loadSettings(): DeviceSettings {
  try {
    const raw = localStorage.getItem('ashton-life-settings');
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: DeviceSettings): void {
  try { localStorage.setItem('ashton-life-settings', JSON.stringify(s)); } catch { /* private mode */ }
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickTextFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? await file.text() : null);
    };
    input.click();
  });
}
