// The click grant (docs/pilot-auto-mode-design.md §1.3): besides the user's
// own message, the one way a sample fact, the edge trim, the symmetry
// average, the |Q| band or the magnetic ion changes, and the one way a ring
// change goes ahead without a 3D verdict ("Apply anyway"). Only a trusted
// click or key press on an Apply card creates one (grantForClick: the DOM
// event's isTrusted), for the exact changes the card shows, on its dataset.
// update_settings honours it once, on the app's own call (AppCallContext),
// for those changes alone; the apply it was made for revokes it, whatever
// happened (apply/actions.ts).
//
// Why the model cannot reach one:
//  - A grant is a token: an empty frozen object whose terms live in this
//    module's WeakMap, and nowhere else. A copy of it (JSON, structuredClone,
//    a string naming it) is no key there, so it is no grant. It serializes as
//    {}, so no message, session file or storage can hold one, and a reload
//    starts with none.
//  - The model controls tool arguments and its own text. update_settings
//    reads only its arguments' `changes`, and the grant from the context,
//    which the round builds for every model call from the chat's context
//    (tools/round.ts), which never holds one.
//  - Even a token that leaked onto a model call grants nothing: a model call
//    carries the reply's skills read (startReply sets them on every one), and
//    a call that does is refused the grant, which it uses up.
//
// A leaf module: types alone come in, so update_settings can import it.

import type { ToolContext } from "./tools/types";

declare const GRANT: unique symbol;

/** A click grant: an opaque token. Its terms are this module's alone. */
export type Grant = { readonly [GRANT]: true };

/** What a grant allows: the card it was made for, its dataset, and the changes, exactly, as the user saw them. */
export interface GrantTerms {
  readonly id: number;
  readonly card: string;
  readonly dataset: string;
  readonly changes: Readonly<Record<string, unknown>>;
}

/** The context of the app's own update_settings call for a card: a tool context, with the click's grant. */
export type AppCallContext = ToolContext & { readonly grant?: Grant };

/** The event a handler got: a DOM event (React's nativeEvent), whose isTrusted only the browser sets true. */
export type ClickEvent = { readonly isTrusted?: unknown } | null | undefined;

const TERMS = new WeakMap<object, GrantTerms>();
let nextId = 1;

const deepFreeze = <T>(v: T): T => {
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
};

/** Whether `event` is a click or key press the user made: the browser's own, not one a script dispatched. */
export const isTrustedClick = (event: ClickEvent): boolean => !!event && event.isTrusted === true;

/**
 * A grant for card `card`'s `changes` on `dataset`, made in the card's click
 * or key handler from the DOM event; null when the event is no trusted one,
 * or there is nothing to grant. The changes are copied and frozen: what the
 * caller does with its own object afterwards changes nothing the grant
 * allows.
 */
export function grantForClick(event: ClickEvent, request: { card: string; dataset: string; changes: Record<string, unknown> }): Grant | null {
  if (!isTrustedClick(event)) return null;
  if (!request.card || !request.dataset || !request.changes || typeof request.changes !== "object" || Array.isArray(request.changes)) return null;
  let changes: Record<string, unknown>;
  try {
    changes = JSON.parse(JSON.stringify(request.changes)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!Object.keys(changes).length) return null;
  const token = Object.freeze({});
  TERMS.set(token, Object.freeze({ id: nextId++, card: request.card, dataset: request.dataset, changes: deepFreeze(changes) }));
  return token as unknown as Grant;
}

/** Whether `grant` is a live grant made for card `card` (the apply checks it before its call). */
export function grantIsFor(grant: unknown, card: string): boolean {
  return !!grant && typeof grant === "object" && TERMS.get(grant)?.card === card;
}

/** Revoke a grant: the apply it was made for does, whatever happened. */
export function revokeGrant(grant: unknown): void {
  if (grant && typeof grant === "object") TERMS.delete(grant);
}

/**
 * The terms of the grant a call's context carries, used up by this read:
 * null when it carries none, one that is no live grant, one for another
 * dataset, or when the call is a model's (it carries the reply's skills
 * read: startReply, tools/round.ts), whose grant is used up all the same.
 */
export function redeemGrant(ctx: Readonly<ToolContext>): GrantTerms | null {
  const grant: unknown = (ctx as AppCallContext).grant;
  if (!grant || typeof grant !== "object") return null;
  const terms = TERMS.get(grant);
  if (!terms) return null;
  TERMS.delete(grant);
  if (ctx.skillsRead !== undefined) return null;
  if (ctx.dataset?.id !== terms.dataset) return null;
  return terms;
}

const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
      : v;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * Whether redeemed terms cover the change of `key` to `value`: the key is
 * one the click approved, at the value it approved, written the same, or
 * with the same canonical fields by `write` (update_settings' own; one that
 * throws covers nothing). A grant for punchSupercellL 2 covers no 3, and no
 * other setting.
 */
export function grantCovers(terms: GrantTerms | null, key: string, value: unknown, write?: (value: unknown) => object): boolean {
  if (!terms || !Object.prototype.hasOwnProperty.call(terms.changes, key)) return false;
  const approved = terms.changes[key];
  if (same(approved, value)) return true;
  if (!write) return false;
  try {
    return same(write(approved), write(value));
  } catch {
    return false;
  }
}
