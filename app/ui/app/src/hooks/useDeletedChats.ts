import { useQuery } from "@tanstack/react-query";
import { getDeletedChats } from "@/api";

/**
 * Soft-deleted chats still within the 30-day grace window. Sorted
 * newest-deleted-first by the server.
 */
export function useDeletedChats() {
  return useQuery({
    queryKey: ["chats", "deleted"],
    queryFn: getDeletedChats,
  });
}