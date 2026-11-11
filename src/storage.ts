import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Club, Snapshot } from './types.js';

type ChatId = string | number;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS subscriptions (
    chat_id    TEXT NOT NULL,
    club_id    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (chat_id, club_id)
  );
  CREATE INDEX IF NOT EXISTS idx_subscriptions_club ON subscriptions (club_id);

  -- Останній відомий стан кожного клубу (для порівняння при наступній перевірці)
  CREATE TABLE IF NOT EXISTS club_state (
    club_id  TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    status   TEXT NOT NULL,       -- JSON: { "Світло": true, ... }
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`;

/** Сховище на SQLite: підписки користувачів і останній відомий стан таблиці. */
export class Storage {
  private readonly db: DatabaseSync;
  private readonly stmt: Record<
    | 'subsOfChat' | 'isSubscribed' | 'subscribe' | 'unsubscribe' | 'removeChat' | 'subscribersOf'
    | 'clubStates' | 'clearClubStates' | 'insertClubState' | 'getMeta' | 'setMeta',
    StatementSync
  >;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);

    this.stmt = {
      subsOfChat: this.db.prepare('SELECT club_id FROM subscriptions WHERE chat_id = ? ORDER BY created_at'),
      isSubscribed: this.db.prepare('SELECT 1 FROM subscriptions WHERE chat_id = ? AND club_id = ?'),
      subscribe: this.db.prepare('INSERT OR IGNORE INTO subscriptions (chat_id, club_id) VALUES (?, ?)'),
      unsubscribe: this.db.prepare('DELETE FROM subscriptions WHERE chat_id = ? AND club_id = ?'),
      removeChat: this.db.prepare('DELETE FROM subscriptions WHERE chat_id = ?'),
      subscribersOf: this.db.prepare('SELECT chat_id FROM subscriptions WHERE club_id = ?'),
      clubStates: this.db.prepare('SELECT club_id, name, status FROM club_state ORDER BY position'),
      clearClubStates: this.db.prepare('DELETE FROM club_state'),
      insertClubState: this.db.prepare(
        'INSERT INTO club_state (club_id, name, status, position) VALUES (?, ?, ?, ?)',
      ),
      getMeta: this.db.prepare('SELECT value FROM meta WHERE key = ?'),
      setMeta: this.db.prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ),
    };
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  getSubscriptions(chatId: ChatId): string[] {
    return this.stmt.subsOfChat.all(String(chatId)).map((r) => String(r.club_id));
  }

  isSubscribed(chatId: ChatId, clubId: string): boolean {
    return this.stmt.isSubscribed.get(String(chatId), clubId) !== undefined;
  }

  setSubscribed(chatId: ChatId, clubIds: string | string[], subscribed: boolean): void {
    const stmt = subscribed ? this.stmt.subscribe : this.stmt.unsubscribe;
    this.transaction(() => {
      for (const id of ([] as string[]).concat(clubIds)) stmt.run(String(chatId), id);
    });
  }

  /** Перемикає підписку; повертає новий стан. */
  toggle(chatId: ChatId, clubId: string): boolean {
    const next = !this.isSubscribed(chatId, clubId);
    this.setSubscribed(chatId, clubId, next);
    return next;
  }

  removeUser(chatId: ChatId): void {
    this.stmt.removeChat.run(String(chatId));
  }

  /** chatId підписників клубу */
  subscribersOf(clubId: string): string[] {
    return this.stmt.subscribersOf.all(clubId).map((r) => String(r.chat_id));
  }

  get lastSnapshot(): Snapshot | null {
    const rows = this.stmt.clubStates.all();
    if (!rows.length) return null;
    const clubs: Club[] = rows.map((r) => ({
      id: String(r.club_id),
      name: String(r.name),
      status: JSON.parse(String(r.status)) as Club['status'],
    }));
    const updatedAt = this.stmt.getMeta.get('sheet_updated_at')?.value;
    return { updatedAt: updatedAt == null ? null : String(updatedAt), clubs };
  }

  setLastSnapshot(snapshot: Snapshot): void {
    this.transaction(() => {
      this.stmt.clearClubStates.run();
      snapshot.clubs.forEach((c, i) => this.stmt.insertClubState.run(c.id, c.name, JSON.stringify(c.status), i));
      this.stmt.setMeta.run('sheet_updated_at', snapshot.updatedAt);
    });
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}
