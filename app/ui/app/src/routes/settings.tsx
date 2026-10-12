import { createFileRoute } from "@tanstack/react-router";
import Settings from "@/components/Settings";
import { SidebarLayout } from "@/components/layout/layout";
import { ChatSidebar } from "@/components/ChatSidebar";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <SidebarLayout sidebar={<ChatSidebar />}>
      <Settings />
    </SidebarLayout>
  );
}