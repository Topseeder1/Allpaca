import { useMutation, useQueryClient } from "@tanstack/react-query";
import { archiveChat, unarchiveChat } from "@/api";

interface ArchiveArgs {
  chatId: string;
  archive: boolean;
}

/**
 * Toggle a chat's archived state. One mutation covers both directions so
 * callers don't have to pick between two hooks.
 */
export function useArchiveChat() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ chatId, archive }: ArchiveArgs) => {
      if (archive) {
        await archiveChat(chatId);
      } else {
        await unarchiveChat(chatId);
      }
    },
    onSuccess: () => {
      // invalidateQueries matches by prefix, so this also refreshes
      // ["chats", "archived"] and ["chats", "deleted"].
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}