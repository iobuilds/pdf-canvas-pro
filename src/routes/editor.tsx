import { createFileRoute } from "@tanstack/react-router";
import { PdfEditorShell } from "@/components/pdf-saas/PdfEditorShell";

export const Route = createFileRoute("/editor")({
  head: () => ({
    meta: [
      { title: "PDF Editor — DocuForge" },
      { name: "description", content: "Edit, annotate, sign, and export PDFs in a browser workspace." },
      { property: "og:title", content: "PDF Editor — DocuForge" },
      { property: "og:description", content: "A responsive Acrobat-style PDF editor interface." },
    ],
  }),
  component: PdfEditorShell,
});
