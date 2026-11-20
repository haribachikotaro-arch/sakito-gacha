import type { CapsuleColor, PrizeKind, SavedTicket } from "./types";

const prefix = "sakito-v3-";
export const preferences = {
  read(key: string, fallback: unknown = null): unknown {
    try { return JSON.parse(localStorage.getItem(prefix + key) ?? "null") ?? fallback; }
    catch { return fallback; }
  },
  write(key: string, value: unknown): void {
    try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch {}
  },
  remove(key: string): void {
    try { localStorage.removeItem(prefix + key); } catch {}
  }
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isPrizeKind(value: unknown): value is PrizeKind {
  return value === "gold" || value === "normal" || value === "none";
}

export function isCapsuleColor(value: unknown): value is CapsuleColor {
  return typeof value === "string" && ["gold","black","gray","blue","orange","green","red","purple"].includes(value);
}

export function readTickets(): SavedTicket[] {
  const account = preferences.read("account");
  const raw = preferences.read("tickets", isRecord(account) ? account.tickets : []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((ticket): ticket is Record<string,unknown> & {title:string} =>
    isRecord(ticket) && typeof ticket.title === "string"
  ).map(ticket => ({
    type: isPrizeKind(ticket.type) ? ticket.type : "normal",
    color: isCapsuleColor(ticket.color) ? ticket.color : "blue",
    title: ticket.title,
    store: typeof ticket.store === "string" ? ticket.store : "",
    expiry: typeof ticket.expiry === "string" ? ticket.expiry : "",
    obtained: typeof ticket.obtained === "string" ? ticket.obtained : undefined,
  }));
}
