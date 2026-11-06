import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteChat } from "@/api";
import { useNavigate } from "@tanstack/react-router";
import { ChatsResponse } from "@/gotypes";

// How long a delete can be undone before it is committed to the server.
const UNDO_WINDOW_MS = 6000;

export interface PendingDelete {
  chatId: string;
  title: string;
}

/**
 * Deferred delete with an undo window.
 *
 * - `schedule(chatId, title)` removes the chat optimistically and starts a
 *   countdown. The server is only called when the countdown expires.
 * - `undo(chatId)` cancels the countdown and refetches, restoring the chat.
 * - `pending` is the list of deletes currently waiting to commit (used to
 *   render undo toasts).
 *
 * Because the server call is deferred, an undo needs no snapshot: the chat
 * still exists server-side, so a refetch brings it straight back.
 */
export function useDeleteChat() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingDelete[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const { mutate } = useMutation({
    mutationFn: (chatId: string) => deleteChat(chatId),
    onSuccess: (_, chatId) => {
      // If we're currently viewing the deleted chat, navigate away.
      const currentPath = window.location.pathname;
      if (currentPath === `/c/${chatId}`) {
        navigate({ to: "/c/$chatId", params: { chatId: "new" } });
      }

      queryClient.invalidateQueries({ queryKey: ["chats"] });
    },
    onError: (error, chatId) => {
      console.error("Failed to delete chat:", chatId, error);
      // Put the chat back in the list if the server rejected the delete.
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    },
  });

  const schedule = useCallback(
    (chatId: string, title: string) => {
      // Already scheduled — ignore duplicate triggers.
      if (timers.current.has(chatId)) return;

      // Optimistically drop the chat from the list.
      //
      // ChatsResponse is a generated class with a `convertValues` prototype
      // method, so we must return a real instance rather than a spread object.
      // Spreading a class instance drops its prototype and fails the
      // Updater<ChatsResponse> return type at compile time.
      queryClient.setQueryData<ChatsResponse>(["chats"], (old) => {
        if (!old?.chatInfos) return old;
        return new ChatsResponse({
          ...old,
          chatInfos: old.chatInfos.filter((chat) => chat.id !== chatId),
        });
      });

      setPending((prev) => [...prev, { chatId, title }]);

      const timer = setTimeout(() => {
        timers.current.delete(chatId);
        setPending((prev) => prev.filter((item) => item.chatId !== chatId));
        mutate(chatId);
      }, UNDO_WINDOW_MS);

      timers.current.set(chatId, timer);
    },
    [mutate, queryClient],
  );

  const undo = useCallback(
    (chatId: string) => {
      const timer = timers.current.get(chatId);
      if (timer) {
        clearTimeout(timer);
        timers.current.delete(chatId);
      }

      setPending((prev) => prev.filter((item) => item.chatId !== chatId));

      // The server-side delete has not fired yet, so refetching restores it.
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    },
    [queryClient],
  );

  // Commit any still-pending deletes if the sidebar unmounts, so a scheduled
  // delete is never silently lost.
  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      for (const [chatId, timer] of activeTimers) {
        clearTimeout(timer);
        mutate(chatId);
      }
      activeTimers.clear();
    };
  }, [mutate]);

  return { schedule, undo, pending };
}