import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/pdf-saas/PdfEditorShell";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — DocuForge" },
      { name: "description", content: "Manage PDF projects, signatures, usage, and secure storage." },
      { property: "og:title", content: "Dashboard — DocuForge" },
      { property: "og:description", content: "PDF project dashboard for teams." },
    ],
  }),
  component: DashboardShell,
});
