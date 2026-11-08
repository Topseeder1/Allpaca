import {
  ChatResponse,
  ChatsResponse,
  ChatEvent,
  DownloadEvent,
  ErrorEvent,
  InferenceCompute,
  InferenceComputeResponse,
  ModelCapabilitiesResponse,
  Model,
  ChatRequest,
  Settings,
  User,
  Project,
  ProjectsResponse,
  ProjectStats,
} from "@/gotypes";
import { parseJsonlFromResponse } from "./util/jsonl-parsing";
import { ollamaClient as ollama } from "./lib/ollama-client";
import type { ModelResponse } from "ollama/browser";
import { API_BASE, OLLAMA_DOT_COM } from "./lib/config";

// Extend Model class with utility methods
declare module "@/gotypes" {
  interface Model {
    isCloud(): boolean;
  }
}

Model.prototype.isCloud = function (): boolean {
  return this.model.endsWith("cloud");
};

function uint8ArrayToBase64(uint8Array: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function fetchUser(): Promise<User | null> {
  const response = await fetch(`${API_BASE}/api/me`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (response.ok) {
    const userData: User = await response.json();
    if (userData.avatarurl && !userData.avatarurl.startsWith("http")) {
      userData.avatarurl = `${OLLAMA_DOT_COM}${userData.avatarurl}`;
    }
    return userData;
  }

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  throw new Error(`Failed to fetch user: ${response.status}`);
}

export async function fetchConnectUrl(): Promise<string> {
  const response = await fetch(`${API_BASE}/api/me`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (response.status === 401) {
    const data = await response.json();
    if (data.signin_url) {
      return data.signin_url;
    }
  }

  throw new Error("Failed to fetch connect URL");
}

export async function disconnectUser(): Promise<void> {
  const response = await fetch(`${API_BASE}/api/signout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error("Failed to disconnect user");
  }
}

// getChats returns the unfiled (root) chat list, or a specific project's chat
// list when projectId is provided.
export async function getChats(
  projectId?: string | null,
): Promise<ChatsResponse> {
  const params = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
  const response = await fetch(`${API_BASE}/api/v1/chats${params}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch chats: ${response.status}`);
  }
  const data = await response.json();
  return new ChatsResponse(data);
}

// getArchivedChats returns only chats with archivedAt set that are not
// deleted. Sorted newest-archived-first by the server. Archive is a global
// view — no project filter.
export async function getArchivedChats(): Promise<ChatsResponse> {
  const response = await fetch(`${API_BASE}/api/v1/chats/archived`);
  if (!response.ok) {
    throw new Error(`Failed to fetch archived chats: ${response.status}`);
  }
  const data = await response.json();
  return new ChatsResponse(data);
}

// getDeletedChats returns soft-deleted chats still within the 30-day grace
// window. Once purged server-side or after 30 days, they disappear here.
export async function getDeletedChats(): Promise<ChatsResponse> {
  const response = await fetch(`${API_BASE}/api/v1/chats/deleted`);
  if (!response.ok) {
    throw new Error(`Failed to fetch deleted chats: ${response.status}`);
  }
  const data = await response.json();
  return new ChatsResponse(data);
}

export async function getChat(chatId: string): Promise<ChatResponse> {
  const response = await fetch(`${API_BASE}/api/v1/chat/${chatId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch chat: ${response.status}`);
  }
  const data = await response.json();
  return new ChatResponse(data);
}

// ---------- Projects ----------

export async function getProjects(): Promise<ProjectsResponse> {
  const response = await fetch(`${API_BASE}/api/v1/projects`);
  if (!response.ok) {
    throw new Error(`Failed to fetch projects: ${response.status}`);
  }
  const data = await response.json();
  return new ProjectsResponse(data);
}

export async function createProject(
  name: string,
  parentId?: string | null,
): Promise<Project> {
  const response = await fetch(`${API_BASE}/api/v1/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parentId: parentId ?? null }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create project: ${response.status}`);
  }
  const data = await response.json();
  return new Project(data);
}

export async function renameProject(
  id: string,
  name: string,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/project/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error(`Failed to rename project: ${response.status}`);
  }
}

export async function deleteProject(
  id: string,
  mode: "promote" | "delete",
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/api/v1/project/${id}?mode=${encodeURIComponent(mode)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(`Failed to delete project: ${response.status}`);
  }
}

export async function moveChatToProject(
  chatId: string,
  projectId: string | null,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/chat/${chatId}/project`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
  if (!response.ok) {
    throw new Error(`Failed to move chat: ${response.status}`);
  }
}

export async function getProjectStats(id: string): Promise<ProjectStats> {
  const response = await fetch(`${API_BASE}/api/v1/project/${id}/stats`);
  if (!response.ok) {
    throw new Error(`Failed to fetch project stats: ${response.status}`);
  }
  const data = await response.json();
  return new ProjectStats(data);
}

// ---------- Models ----------

export async function getModels(query?: string): Promise<Model[]> {
  try {
    const { models: modelsResponse } = await ollama.list();

    let models: Model[] = modelsResponse
      .filter((m: ModelResponse) => {
        const families = m.details?.families;
        if (!families || families.length === 0) return true;
        const isBertOnly = families.every((family: string) =>
          family.toLowerCase().includes("bert"),
        );
        return !isBertOnly;
      })
      .map((m: ModelResponse) => {
        const modelName = m.name.replace(/:latest$/, "");
        const origin = (m as { origin?: string }).origin;
        return new Model({
          model: modelName,
          origin,
          digest: m.digest,
          modified_at: m.modified_at ? new Date(m.modified_at) : undefined,
        });
      });

    if (query) {
      const normalizedQuery = query.toLowerCase().trim();
      const filteredModels = models.filter((m: Model) =>
        m.model.toLowerCase().startsWith(normalizedQuery),
      );

      let exactMatch = false;
      for (const m of filteredModels) {
        if (m.model.toLowerCase() === normalizedQuery) {
          exactMatch = true;
          break;
        }
      }

      if (!exactMatch) {
        const result = await getModelUpstreamInfo(new Model({ model: query }));
        const existsUpstream = !!result.digest && !result.error;
        if (existsUpstream) {
          filteredModels.push(new Model({ model: query }));
        }
      }

      models = filteredModels;
    }

    return models;
  } catch (err) {
    throw new Error(`Failed to fetch models: ${err}`);
  }
}

export async function getModelCapabilities(
  modelName: string,
): Promise<ModelCapabilitiesResponse> {
  try {
    const showResponse = await ollama.show({ model: modelName });
    return new ModelCapabilitiesResponse({
      capabilities: Array.isArray(showResponse.capabilities)
        ? showResponse.capabilities
        : [],
    });
  } catch (error) {
    console.error(`Failed to get capabilities for ${modelName}:`, error);
    return new ModelCapabilitiesResponse({ capabilities: [] });
  }
}

export type ChatEventUnion = ChatEvent | DownloadEvent | ErrorEvent;

export async function* sendMessage(
  chatId: string,
  message: string,
  model: Model,
  attachments?: Array<{ filename: string; data: Uint8Array }>,
  signal?: AbortSignal,
  index?: number,
  webSearch?: boolean,
  fileTools?: boolean,
  forceUpdate?: boolean,
  think?: boolean | string,
  projectId?: string | null,
): AsyncGenerator<ChatEventUnion> {
  const serializedAttachments = attachments?.map((att) => ({
    filename: att.filename,
    data: uint8ArrayToBase64(att.data),
  }));

  const shouldSendThink =
    think !== undefined &&
    (typeof think === "boolean" || (typeof think === "string" && think !== ""));

  const response = await fetch(`${API_BASE}/api/v1/chat/${chatId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      new ChatRequest({
        model: model.model,
        prompt: message,
        ...(index !== undefined ? { index } : {}),
        ...(serializedAttachments !== undefined
          ? { attachments: serializedAttachments }
          : {}),
        web_search: webSearch ?? false,
        file_tools: fileTools ?? false,
        ...(forceUpdate !== undefined ? { forceUpdate } : {}),
        ...(shouldSendThink ? { think } : {}),
        ...(projectId ? { projectId } : {}),
      }),
    ),
    signal,
  });

  for await (const event of parseJsonlFromResponse<ChatEventUnion>(response)) {
    switch (event.eventName) {
      case "download":
        yield new DownloadEvent(event);
        break;
      case "error":
        yield new ErrorEvent(event);
        break;
      default:
        yield new ChatEvent(event);
        break;
    }
  }
}

export async function getSettings(): Promise<{ settings: Settings }> {
  const response = await fetch(`${API_BASE}/api/v1/settings`);
  if (!response.ok) {
    throw new Error("Failed to fetch settings");
  }
  const data = await response.json();
  return { settings: new Settings(data.settings) };
}

export async function updateSettings(settings: Settings): Promise<{
  settings: Settings;
}> {
  const response = await fetch(`${API_BASE}/api/v1/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to update settings");
  }
  const data = await response.json();
  return { settings: new Settings(data.settings) };
}

export async function renameChat(chatId: string, title: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/chat/${chatId}/rename`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: title.trim() }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to rename chat");
  }
}

export async function deleteChat(chatId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/chat/${chatId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to delete chat");
  }
}

export async function archiveChat(chatId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/chat/${chatId}/archive`, {
    method: "POST",
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to archive chat");
  }
}

export async function unarchiveChat(chatId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/chat/${chatId}/unarchive`, {
    method: "POST",
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to unarchive chat");
  }
}

export async function restoreChat(chatId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/chat/${chatId}/restore`, {
    method: "POST",
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to restore chat");
  }
}

export async function purgeChat(chatId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/chat/${chatId}/purge`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to purge chat");
  }
}

export async function getModelUpstreamInfo(
  model: Model,
): Promise<{ digest?: string; pushTime: number; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}/api/v1/model/upstream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model.model }),
    });

    if (!response.ok) {
      console.warn(
        `Failed to check upstream digest for ${model.model}: ${response.status}`,
      );
      return { pushTime: 0 };
    }

    const data = await response.json();
    if (data.error) {
      console.warn(`Upstream digest check: ${data.error}`);
      return { error: data.error, pushTime: 0 };
    }
    return { digest: data.digest, pushTime: data.pushTime || 0 };
  } catch (error) {
    console.warn(`Error checking model staleness:`, error);
    return { pushTime: 0 };
  }
}

export async function* pullModel(
  modelName: string,
  signal?: AbortSignal,
): AsyncGenerator<{
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  done?: boolean;
}> {
  const response = await fetch(`${API_BASE}/api/v1/models/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: modelName }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to pull model: ${response.statusText}`);
  }

  for await (const event of parseJsonlFromResponse<{
    status: string;
    digest?: string;
    total?: number;
    completed?: number;
    done?: boolean;
  }>(response)) {
    yield event;
  }
}

export async function getInferenceCompute(): Promise<InferenceCompute[]> {
  const response = await fetch(`${API_BASE}/api/v1/inference-compute`);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch inference compute: ${response.statusText}`,
    );
  }
  const data = await response.json();
  const inferenceComputeResponse = new InferenceComputeResponse(data);
  return inferenceComputeResponse.inferenceComputes || [];
}

export async function fetchHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/version`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (response.ok) {
      const data = await response.json();
      return !!data.version;
    }
    return false;
  } catch (error) {
    console.error("Error checking health:", error);
    return false;
  }
}