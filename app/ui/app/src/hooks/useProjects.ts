import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getProjects,
  createProject,
  renameProject,
  deleteProject,
  moveChatToProject,
} from "@/api";

/**
 * Full flat list of projects. Callers build the tree client-side via
 * parentId — cheap because the tree is small and this avoids a recursive
 * SQL query and a second round trip per node.
 */
export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      parentId,
    }: {
      name: string;
      parentId?: string | null;
    }) => createProject(name, parentId ?? null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useRenameProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameProject(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: "promote" | "delete" }) =>
      deleteProject(id, mode),
    onSuccess: () => {
      // Invalidate projects, the unfiled chat list (chats may have been
      // promoted), the trash (chats may have been soft-deleted), and every
      // project-specific chat list — a single ["chats"] prefix hits them all.
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}

export function useMoveChatToProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      chatId,
      projectId,
    }: {
      chatId: string;
      projectId: string | null;
    }) => moveChatToProject(chatId, projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}