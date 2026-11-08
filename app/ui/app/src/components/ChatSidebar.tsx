import { useChats } from "@/hooks/useChats";
import { useArchivedChats } from "@/hooks/useArchivedChats";
import { useDeletedChats } from "@/hooks/useDeletedChats";
import { useRenameChat } from "@/hooks/useRenameChat";
import { useDeleteChat } from "@/hooks/useDeleteChat";
import { useArchiveChat } from "@/hooks/useArchiveChat";
import {
  useCreateProject,
  useDeleteProject,
  useMoveChatToProject,
  useProjects,
  useRenameProject,
} from "@/hooks/useProjects";
import { useQueryClient } from "@tanstack/react-query";
import { getChat, restoreChat, purgeChat } from "@/api";
import { Link } from "@/components/ui/link";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { ChatsResponse } from "@/gotypes";
import {
  CogIcon,
  EllipsisHorizontalIcon,
  ArrowUturnLeftIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { UndoToast } from "@/components/UndoToast";
import { ChatActionsMenu } from "@/components/ChatActionsMenu";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { ProjectsPanel } from "@/components/ProjectsPanel";
import { ProjectBreadcrumb } from "@/components/ProjectBreadcrumb";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { DeleteProjectDialog } from "@/components/DeleteProjectDialog";

const DEBUG_SHIFT_CLICKS_REQUIRED = 5;
const DEBUG_SHIFT_CLICK_WINDOW_MS = 7000;

const ACTION_MENU_WIDTH = 224;
const ACTION_MENU_HEIGHT = 160; // four entries in main mode, rounded
const ACTION_MENU_MARGIN = 8;
const PURGE_CONFIRM_WINDOW_MS = 4000;

interface ChatSidebarProps {
  currentChatId?: string;
}

interface ActionMenuState {
  chatId: string;
  title: string;
  top: number;
  left: number;
  isArchived?: boolean;
  currentProjectId?: string | null;
}

interface NewProjectDialogState {
  parentId?: string | null;
  initialName?: string;
  mode: "new" | "rename";
  renameId?: string;
}

interface DeleteProjectDialogState {
  id: string;
  name: string;
}

export function ChatSidebar({ currentChatId }: ChatSidebarProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );

  const { data, isLoading, error } = useChats(selectedProjectId);
  const archivedQuery = useArchivedChats();
  const deletedQuery = useDeletedChats();
  const projectsQuery = useProjects();
  const queryClient = useQueryClient();
  const renameMutation = useRenameChat();
  const archiveMutation = useArchiveChat();
  const moveMutation = useMoveChatToProject();
  const createProjectMutation = useCreateProject();
  const renameProjectMutation = useRenameProject();
  const deleteProjectMutation = useDeleteProject();
  const {
    schedule: scheduleDelete,
    undo: undoDelete,
    pending: pendingDeletes,
  } = useDeleteChat();

  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [shiftClicks, setShiftClicks] = useState<Record<string, number[]>>({});
  const [copiedChatId, setCopiedChatId] = useState<string | null>(null);
  const [actionMenu, setActionMenu] = useState<ActionMenuState | null>(null);
  const [confirmPurgeId, setConfirmPurgeId] = useState<string | null>(null);
  const [newProjectDialog, setNewProjectDialog] =
    useState<NewProjectDialogState | null>(null);
  const [deleteProjectDialog, setDeleteProjectDialog] =
    useState<DeleteProjectDialogState | null>(null);

  const projects = projectsQuery.data?.projects ?? [];

  // Reset selection if the selected project disappears from the list — this
  // happens when a project is deleted (by us, or as part of a subtree).
  useEffect(() => {
    if (selectedProjectId && projects.length >= 0 && projectsQuery.isSuccess) {
      if (!projects.some((p) => p.id === selectedProjectId)) {
        setSelectedProjectId(null);
      }
    }
  }, [selectedProjectId, projects, projectsQuery.isSuccess]);

  const closeActionMenu = useCallback(() => setActionMenu(null), []);

  const handleMouseEnter = useCallback(
    (chatId: string) => {
      queryClient.prefetchQuery({
        queryKey: ["chat", chatId],
        queryFn: () => getChat(chatId),
        staleTime: 1500,
      });
    },
    [queryClient],
  );

  const startEditing = useCallback((chatId: string, currentTitle: string) => {
    setEditingChatId(chatId);
    setEditValue(currentTitle);
  }, []);

  const saveRename = useCallback(async () => {
    if (!editingChatId || !editValue.trim()) {
      setEditingChatId(null);
      return;
    }

    const newTitle = editValue.trim();
    const chatId = editingChatId;

    setEditingChatId(null);
    setEditValue("");

    queryClient.setQueryData(
      ["chats", "list", selectedProjectId ?? "root"],
      (oldData: ChatsResponse | undefined) => {
        if (!oldData?.chatInfos) return oldData;
        return new ChatsResponse({
          ...oldData,
          chatInfos: oldData.chatInfos.map((chat) =>
            chat.id === chatId ? { ...chat, title: newTitle } : chat,
          ),
        });
      },
    );

    try {
      await renameMutation.mutateAsync({ chatId, title: newTitle });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error: unknown) {
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    }
  }, [editingChatId, editValue, renameMutation, queryClient, selectedProjectId]);

  useEffect(() => {
    if (editingChatId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingChatId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        saveRename();
      }
    };

    if (editingChatId) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [editingChatId, saveRename]);

  const sortedChats = useMemo(() => {
    if (!data?.chatInfos) return [];
    return [...data.chatInfos].sort((a, b) => {
      const comparison = b.updatedAt.getTime() - a.updatedAt.getTime();
      if (comparison === 0) {
        return b.id.localeCompare(a.id);
      }
      return comparison;
    });
  }, [data?.chatInfos]);

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const isThisWeek = (date: Date) => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return date > weekAgo && !isToday(date);
  };

  const groupedChats = useMemo(() => {
    const groups = {
      today: [] as typeof sortedChats,
      thisWeek: [] as typeof sortedChats,
      older: [] as typeof sortedChats,
    };

    sortedChats.forEach((chat) => {
      if (isToday(chat.updatedAt)) {
        groups.today.push(chat);
      } else if (isThisWeek(chat.updatedAt)) {
        groups.thisWeek.push(chat);
      } else {
        groups.older.push(chat);
      }
    });

    return groups;
  }, [sortedChats]);

  const chatGroups = useMemo(() => {
    return [
      { name: "Today", chats: groupedChats.today },
      { name: "This week", chats: groupedChats.thisWeek },
      { name: "Older", chats: groupedChats.older },
    ].filter((group) => group.chats.length > 0);
  }, [groupedChats]);

  // Breadcrumb + child chips derive from the flat project list.
  const breadcrumb = useMemo(() => {
    if (!selectedProjectId) return [];
    const map = new Map(projects.map((p) => [p.id, p]));
    const chain: Array<{ id: string; name: string }> = [];
    let cur: string | null | undefined = selectedProjectId;
    const guard = new Set<string>();
    while (cur) {
      if (guard.has(cur)) break; // cycle safety — should never happen
      guard.add(cur);
      const p = map.get(cur);
      if (!p) break;
      chain.unshift({ id: p.id, name: p.name });
      cur = p.parentId ?? null;
    }
    return chain;
  }, [selectedProjectId, projects]);

  const childProjects = useMemo(() => {
    if (!selectedProjectId) return [];
    return projects
      .filter((p) => p.parentId === selectedProjectId)
      .map((p) => ({ id: p.id, name: p.name }));
  }, [projects, selectedProjectId]);

  const handleDeleteChat = useCallback(
    (chatId: string, chatTitle: string) => {
      scheduleDelete(chatId, chatTitle);
    },
    [scheduleDelete],
  );

  const handleArchiveToggle = useCallback(
    async (chatId: string, archive: boolean) => {
      try {
        await archiveMutation.mutateAsync({ chatId, archive });
      } catch (err: unknown) {
        console.error("Failed to toggle archive:", err);
      }
    },
    [archiveMutation],
  );

  const handleMoveToProject = useCallback(
    async (chatId: string, projectId: string | null) => {
      try {
        await moveMutation.mutateAsync({ chatId, projectId });
      } catch (err) {
        console.error("Failed to move chat:", err);
      }
    },
    [moveMutation],
  );

  const handleRestoreChat = useCallback(
    async (chatId: string) => {
      try {
        await restoreChat(chatId);
        queryClient.invalidateQueries({ queryKey: ["chats"] });
      } catch (err) {
        console.error("Failed to restore chat:", err);
      }
    },
    [queryClient],
  );

  const handlePurgeChat = useCallback(
    async (chatId: string) => {
      if (confirmPurgeId !== chatId) {
        setConfirmPurgeId(chatId);
        setTimeout(() => {
          setConfirmPurgeId((current) => (current === chatId ? null : current));
        }, PURGE_CONFIRM_WINDOW_MS);
        return;
      }
      try {
        await purgeChat(chatId);
        queryClient.invalidateQueries({ queryKey: ["chats"] });
      } catch (err) {
        console.error("Failed to purge chat:", err);
      }
      setConfirmPurgeId(null);
    },
    [confirmPurgeId, queryClient],
  );

  const handleShiftClick = useCallback(
    async (e: React.MouseEvent, chatId: string) => {
      if (!e.shiftKey) return false;

      e.preventDefault();
      const now = Date.now();

      const clicks = shiftClicks[chatId] || [];
      const recentClicks = clicks.filter(
        (timestamp) => now - timestamp < DEBUG_SHIFT_CLICK_WINDOW_MS,
      );
      recentClicks.push(now);

      setShiftClicks((prev) => ({ ...prev, [chatId]: recentClicks }));

      if (recentClicks.length >= DEBUG_SHIFT_CLICKS_REQUIRED) {
        try {
          const chatData = await getChat(chatId);
          const jsonString = JSON.stringify(chatData, null, 2);
          await navigator.clipboard.writeText(jsonString);
          setCopiedChatId(chatId);
          setTimeout(() => setCopiedChatId(null), 2000);
          setShiftClicks((prev) => ({ ...prev, [chatId]: [] }));
        } catch (error) {
          console.error("Failed to copy chat data:", error);
        }
      }

      return true;
    },
    [shiftClicks],
  );

  const handleContextMenu = useCallback(
    async (
      _: React.MouseEvent,
      chatId: string,
      chatTitle: string,
      isArchived: boolean = false,
      currentProjectId: string | null = null,
    ) => {
      const selectedAction = await window.menu([
        { label: "Rename", enabled: true },
        { label: isArchived ? "Unarchive" : "Archive", enabled: true },
        { label: "Move to project", enabled: true },
        { label: "Delete", enabled: true },
      ]);

      if (selectedAction === "Rename") {
        startEditing(chatId, chatTitle);
      } else if (selectedAction === "Archive") {
        handleArchiveToggle(chatId, true);
      } else if (selectedAction === "Unarchive") {
        handleArchiveToggle(chatId, false);
      } else if (selectedAction === "Move to project") {
        // Native shell menu has no submenu; use the DOM menu for the picker.
        const rect = { bottom: window.innerHeight / 2, top: 0, right: window.innerWidth / 2 } as DOMRect;
        setActionMenu({
          chatId,
          title: chatTitle,
          top: rect.bottom,
          left: rect.right,
          isArchived,
          currentProjectId,
        });
      } else if (selectedAction === "Delete") {
        handleDeleteChat(chatId, chatTitle);
      }
    },
    [startEditing, handleDeleteChat, handleArchiveToggle],
  );

  const openActionMenu = useCallback(
    (
      chatId: string,
      title: string,
      anchor: HTMLElement,
      isArchived: boolean = false,
      currentProjectId: string | null = null,
    ) => {
      const rect = anchor.getBoundingClientRect();

      let top = rect.bottom + 4;
      if (top + ACTION_MENU_HEIGHT > window.innerHeight - ACTION_MENU_MARGIN) {
        top = rect.top - ACTION_MENU_HEIGHT - 4;
      }

      let left = rect.right - ACTION_MENU_WIDTH;
      if (left < ACTION_MENU_MARGIN) {
        left = ACTION_MENU_MARGIN;
      }
      if (left + ACTION_MENU_WIDTH > window.innerWidth - ACTION_MENU_MARGIN) {
        left = window.innerWidth - ACTION_MENU_WIDTH - ACTION_MENU_MARGIN;
      }

      setActionMenu({ chatId, title, top, left, isArchived, currentProjectId });
    },
    [],
  );

  if (isLoading) {
    return (
      <nav className="flex min-h-0 flex-col">
        <div className="flex flex-1 flex-col p-4">
          <div className="p-4">Loading...</div>
        </div>
      </nav>
    );
  }

  if (error) {
    return (
      <nav className="flex min-h-0 flex-col">
        <div className="flex flex-1 flex-col p-4">
          <div className="p-4 text-red-500">Error loading chats</div>
        </div>
      </nav>
    );
  }

  const isWindows = navigator.platform.toLowerCase().includes("win");
  const archivedChats = archivedQuery.data?.chatInfos ?? [];
  const deletedChats = deletedQuery.data?.chatInfos ?? [];
  const inProject = selectedProjectId !== null;
  const chatsTitle = inProject ? "Chats" : "Chats";

  const renderChatRow = (
    chat: (typeof sortedChats)[number],
    opts: { isArchived?: boolean; allowRename?: boolean } = {},
  ) => {
    const { isArchived = false, allowRename = true } = opts;
    const editing = editingChatId === chat.id;
    const currentProjectId = chat.projectId ?? null;
    return (
      <div
        key={chat.id}
        className={`allow-context-menu group flex items-center relative text-sm text-fg-muted rounded-lg hover:bg-surface-hover ${
          chat.id === currentChatId ? "bg-surface-hover text-fg" : ""
        }`}
        onMouseEnter={() => handleMouseEnter(chat.id)}
        onContextMenu={(e) =>
          handleContextMenu(
            e,
            chat.id,
            chat.title || chat.userExcerpt || chat.createdAt.toLocaleString(),
            isArchived,
            currentProjectId,
          )
        }
      >
        {allowRename && editing ? (
          <div className="flex-1 flex items-center min-w-0 px-2 py-2 bg-surface-hover text-fg rounded-lg">
            <span className="truncate font-sans text-sm w-full">
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveRename();
                  } else if (e.key === "Escape") {
                    setEditingChatId(null);
                    setEditValue("");
                  }
                }}
                className="bg-transparent border-0 focus:outline-none w-full"
                style={{
                  font: "inherit",
                  lineHeight: "inherit",
                  padding: 0,
                  margin: 0,
                }}
              />
            </span>
          </div>
        ) : (
          <Link
            to="/c/$chatId"
            params={{ chatId: chat.id }}
            className="flex-1 flex items-center min-w-0 px-2 py-2 select-none"
            onClick={(e) => {
              handleShiftClick(e, chat.id);
            }}
            draggable={false}
          >
            <span className="truncate font-sans text-sm">
              {chat.title ||
                chat.userExcerpt ||
                chat.createdAt.toLocaleString()}
            </span>
            {copiedChatId === chat.id && (
              <span className="ml-2 text-xs text-green-600 dark:text-green-400">
                Copied!
              </span>
            )}
          </Link>
        )}
        {(!allowRename || !editing) && (
          <button
            type="button"
            aria-label="Chat actions"
            aria-haspopup="menu"
            aria-expanded={actionMenu?.chatId === chat.id}
            title="Chat actions"
            data-chat-menu-trigger
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (actionMenu?.chatId === chat.id) {
                setActionMenu(null);
                return;
              }
              openActionMenu(
                chat.id,
                chat.title ||
                  chat.userExcerpt ||
                  chat.createdAt.toLocaleString(),
                e.currentTarget,
                isArchived,
                currentProjectId,
              );
            }}
            className={`mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-muted transition-opacity hover:text-fg focus:outline-none ${
              chat.id === currentChatId || actionMenu?.chatId === chat.id
                ? "opacity-100"
                : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:opacity-100"
            }`}
          >
            <EllipsisHorizontalIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  };

  return (
    <nav className="flex flex-1 flex-col min-h-0 select-none">
      <header className="flex flex-col gap-0.5 px-4 pb-2">
        <Link
          href="/c/new"
          mask={{ to: "/" }}
          className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-fg hover:bg-surface-hover ${
            currentChatId === "new" ? "bg-surface-hover" : ""
          }`}
          draggable={false}
        >
          <svg
            className="h-5 w-5 fill-current"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M17.0859 3.39949L15.2135 5.27196H7.27028C5.78649 5.27196 4.94684 6.11336 4.94684 7.59716V16.664C4.94684 18.1558 5.78649 18.9892 7.27028 18.9892H16.3406C17.8324 18.9892 18.6623 18.1558 18.6623 16.664V8.79514L20.5428 6.9115C20.567 7.11532 20.5773 7.33066 20.5773 7.55419V16.7149C20.5773 19.4069 19.0818 20.9024 16.3898 20.9024H7.22107C4.53708 20.9024 3.03357 19.4069 3.03357 16.7149V7.55419C3.03357 4.8622 4.53708 3.35869 7.22107 3.35869H16.3898C16.6329 3.35869 16.8662 3.37094 17.0859 3.39949Z" />
            <path d="M9.92714 14.381L11.914 13.5403L20.8312 4.63114L19.3404 3.1581L10.433 12.0655L9.55234 13.9964C9.45664 14.2169 9.70293 14.4714 9.92714 14.381ZM21.5767 3.89364L22.2588 3.19384C22.6347 2.80184 22.6435 2.2663 22.2711 1.90536L22.0148 1.64287C21.6822 1.31377 21.1334 1.36513 20.7689 1.72158L20.0859 2.39833L21.5767 3.89364Z" />
          </svg>
          <span className="truncate">New Chat</span>
        </Link>
        {isWindows && (
          <Link
            href="/settings"
            className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-fg hover:bg-surface-hover`}
            draggable={false}
          >
            <CogIcon className="h-5 w-5 stroke-current" />
            <span className="truncate">Settings</span>
          </Link>
        )}
      </header>

      <div className="flex flex-1 flex-col min-h-0 gap-1 px-4 py-1">
        <ProjectsPanel
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelect={(id) => setSelectedProjectId(id)}
          onNewProject={() =>
            setNewProjectDialog({ mode: "new", parentId: null })
          }
          onRename={(id, currentName) =>
            setNewProjectDialog({
              mode: "rename",
              renameId: id,
              initialName: currentName,
            })
          }
          onDelete={(id) => {
            const p = projects.find((x) => x.id === id);
            if (p) {
              setDeleteProjectDialog({ id: p.id, name: p.name });
            }
          }}
        />

        {inProject && (
          <ProjectBreadcrumb
            breadcrumb={breadcrumb}
            childProjects={childProjects}
            onNavigate={(id) => setSelectedProjectId(id)}
            onNewSubproject={() =>
              setNewProjectDialog({
                mode: "new",
                parentId: selectedProjectId,
              })
            }
          />
        )}

        <CollapsibleSection
          title={chatsTitle}
          count={sortedChats.length}
          defaultOpen
          className="flex-1"
          panelClassName="flex flex-col gap-3 pt-1 overflow-y-auto overscroll-auto scrollbar-gutter min-h-0 flex-1"
        >
          {chatGroups.length === 0 ? (
            <p className="px-2 py-1 text-xs text-fg-muted/70 select-none">
              {inProject ? "No chats in this project yet" : "No unfiled conversations yet"}
            </p>
          ) : (
            chatGroups.map((group) => (
              <div key={group.name} className="flex flex-col gap-0.5">
                <h3 className="text-xs font-medium text-fg-muted px-2 py-1 select-none">
                  {group.name}
                </h3>
                {group.chats.map((chat) => renderChatRow(chat))}
              </div>
            ))
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Archived"
          count={archivedChats.length}
          defaultOpen={false}
          className="shrink-0"
          panelClassName="flex flex-col gap-0.5 pt-1 overflow-y-auto max-h-40"
        >
          {archivedChats.length === 0 ? (
            <p className="px-2 py-1 text-xs text-fg-muted/70 select-none">
              No archived conversations
            </p>
          ) : (
            archivedChats.map((chat) =>
              renderChatRow(chat as (typeof sortedChats)[number], {
                isArchived: true,
                allowRename: false,
              }),
            )
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Recently Deleted"
          count={deletedChats.length}
          defaultOpen={false}
          className="shrink-0"
          panelClassName="flex flex-col gap-0.5 pt-1 overflow-y-auto max-h-40"
        >
          {deletedChats.length === 0 ? (
            <p className="px-2 py-1 text-xs text-fg-muted/70 select-none">
              No deleted conversations
            </p>
          ) : (
            <>
              {deletedChats.map((chat) => {
                const isConfirming = confirmPurgeId === chat.id;
                return (
                  <div
                    key={chat.id}
                    className="group flex items-center relative text-sm text-fg-muted rounded-lg hover:bg-surface-hover"
                  >
                    <div className="flex-1 min-w-0 px-2 py-2">
                      <div className="truncate font-sans text-sm">
                        {chat.title ||
                          chat.userExcerpt ||
                          chat.createdAt.toLocaleString()}
                      </div>
                      {chat.deletedAt && (
                        <div className="truncate text-[11px] text-fg-muted/70 mt-0.5">
                          Deleted {formatRelative(chat.deletedAt)}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label="Restore chat"
                      title="Restore"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleRestoreChat(chat.id);
                      }}
                      className="mr-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:text-fg focus:outline-none"
                    >
                      <ArrowUturnLeftIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={
                        isConfirming
                          ? "Confirm delete forever"
                          : "Delete forever"
                      }
                      title={
                        isConfirming
                          ? "Click again to confirm"
                          : "Delete forever"
                      }
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handlePurgeChat(chat.id);
                      }}
                      className={`mr-1 flex h-6 shrink-0 items-center justify-center rounded-md px-1.5 text-xs focus:outline-none ${
                        isConfirming
                          ? "bg-red-500 text-white hover:bg-red-600"
                          : "text-fg-muted hover:text-red-500"
                      }`}
                    >
                      {isConfirming ? (
                        <span className="whitespace-nowrap">Confirm?</span>
                      ) : (
                        <TrashIcon className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                );
              })}
              <p className="px-2 pt-1 pb-0.5 text-[11px] text-fg-muted/70">
                Purged after 30 days
              </p>
            </>
          )}
        </CollapsibleSection>
      </div>

      {pendingDeletes.length > 0 && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4">
          {pendingDeletes.map((item) => (
            <UndoToast
              key={item.chatId}
              message={`Conversation deleted`}
              onUndo={() => undoDelete(item.chatId)}
            />
          ))}
        </div>
      )}

      {actionMenu &&
        createPortal(
          <ChatActionsMenu
            top={actionMenu.top}
            left={actionMenu.left}
            isArchived={actionMenu.isArchived}
            currentProjectId={actionMenu.currentProjectId ?? null}
            projects={projects.map((p) => ({
              id: p.id,
              name: p.name,
              parentId: p.parentId ?? null,
            }))}
            onRename={() => {
              startEditing(actionMenu.chatId, actionMenu.title);
              setActionMenu(null);
            }}
            onArchive={() => {
              handleArchiveToggle(actionMenu.chatId, !actionMenu.isArchived);
              setActionMenu(null);
            }}
            onDelete={() => {
              handleDeleteChat(actionMenu.chatId, actionMenu.title);
              setActionMenu(null);
            }}
            onMoveToProject={(projectId) => {
              handleMoveToProject(actionMenu.chatId, projectId);
              setActionMenu(null);
            }}
            onCreateProject={() =>
              setNewProjectDialog({ mode: "new", parentId: selectedProjectId })
            }
            onClose={closeActionMenu}
          />,
          document.body,
        )}

      {newProjectDialog && (
        <NewProjectDialog
          title={
            newProjectDialog.mode === "rename"
              ? "Rename project"
              : newProjectDialog.parentId
                ? "New subproject"
                : "New project"
          }
          initialName={newProjectDialog.initialName ?? ""}
          submitLabel={newProjectDialog.mode === "rename" ? "Save" : "Create"}
          onSubmit={(name) => {
            if (
              newProjectDialog.mode === "rename" &&
              newProjectDialog.renameId
            ) {
              renameProjectMutation.mutate({
                id: newProjectDialog.renameId,
                name,
              });
            } else {
              createProjectMutation.mutate({
                name,
                parentId: newProjectDialog.parentId ?? null,
              });
            }
          }}
          onClose={() => setNewProjectDialog(null)}
        />
      )}

      {deleteProjectDialog && (
        <DeleteProjectDialog
          projectId={deleteProjectDialog.id}
          projectName={deleteProjectDialog.name}
          onConfirm={(mode) => {
            deleteProjectMutation.mutate(
              { id: deleteProjectDialog.id, mode },
              {
                onSuccess: () => {
                  // If we were inside the deleted subtree, drop back to root.
                  // The useEffect above also catches this on the refetch, but
                  // doing it here avoids a flash of a stale breadcrumb.
                  if (selectedProjectId === deleteProjectDialog.id) {
                    setSelectedProjectId(null);
                  }
                },
              },
            );
          }}
          onClose={() => setDeleteProjectDialog(null)}
        />
      )}
    </nav>
  );
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}