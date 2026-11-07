import { useQuery } from "@tanstack/react-query";
import { getArchivedChats } from "@/api";

/**
 * Archived chats, in a separate query cache bucket from ["chats"] so that
 * invalidating ["chats"] also refreshes the archive (TanStack matches by
 * prefix), but fetching the archive doesn't pollute the active-list data.
 */
export function useArchivedChats() {
  return useQuery({
    queryKey: ["chats", "archived"],
    queryFn: getArchivedChats,
  });
}