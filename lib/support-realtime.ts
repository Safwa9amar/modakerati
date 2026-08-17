import { supabase } from "./supabase";
import type { SupportMessage } from "./api";

// Live support threads, over Supabase Realtime's postgres_changes.
//
// This is the only place the app reads Postgres directly — everything else goes
// through the Hono server. That is safe because the subscription is READ-ONLY
// and narrowed by RLS: sql/2026-08-17-support-realtime.sql gives
// support_messages a SELECT policy of `user_id = auth.uid() OR is_support_staff()`,
// and Realtime evaluates it per subscriber. A student therefore receives events
// for their own threads and no one else's, with no filter needed on this side —
// and no filter would be trustworthy anyway, since the client chooses it.
//
// Writes still go through the server (POST /api/support/...). The client never
// gains one: there are no INSERT/UPDATE policies at all.

// supabase-js caches channels BY NAME: `supabase.channel("x")` twice hands back
// the same object, and the second caller's `.on()` then lands after the first
// caller's `.subscribe()` — which throws "cannot add postgres_changes callbacks
// after subscribe()". Two screens legitimately watch the same data at once (the
// hub stays mounted underneath the contact list), so every subscriber gets its
// own channel name.
let channelSeq = 0;
const uniqueChannel = (prefix: string) => `${prefix}:${++channelSeq}`;

type MessageRow = {
  id: string;
  conversation_id: string;
  sender: string;
  author_name: string | null;
  body: string;
  created_at: string;
};

/** The realtime row shape mapped onto what the screens already render. */
function toMessage(row: MessageRow): SupportMessage {
  return {
    id: row.id,
    sender: row.sender === "staff" ? "staff" : "student",
    authorName: row.author_name ?? "",
    body: row.body,
    createdAt: row.created_at,
  };
}

/**
 * Watch one conversation. Calls `onMessage` for every message inserted into it,
 * including the student's own — the caller de-duplicates by id, which is also
 * what makes an optimistic append safe.
 *
 * Returns an unsubscribe function; call it on unmount.
 */
export function watchConversation(
  conversationId: string,
  onMessage: (message: SupportMessage) => void
): () => void {
  // Never let a socket problem take the screen down with it. Losing the live
  // feed costs the student a pull-to-refresh; an exception thrown out of the
  // effect costs them the whole help screen, which is the one place they went
  // to BECAUSE something was already wrong.
  try {
    const channel = supabase
      .channel(uniqueChannel(`support:conversation:${conversationId}`))
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "support_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => onMessage(toMessage(payload.new as MessageRow))
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  } catch {
    return () => {};
  }
}

/**
 * Watch every thread the signed-in student owns, for the list screen and the
 * unread badge. No filter: RLS already limits the stream to their own rows, and
 * `onChange` is a cue to refetch rather than a payload to trust.
 */
export function watchMyConversations(onChange: () => void): () => void {
  try {
    const channel = supabase
      .channel(uniqueChannel("support:mine"))
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages" },
        () => onChange()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "support_conversations" },
        () => onChange()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  } catch {
    return () => {};
  }
}
