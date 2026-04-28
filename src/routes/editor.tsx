import { createFileRoute } from "@tanstack/react-router";
import { FunctionalPdfEditor } from "@/components/pdf-saas/FunctionalPdfEditor";

export const Route = createFileRoute("/editor")({
  head: () => ({
    meta: [
      { title: "Functional PDF Editor — DocuForge" },
      { name: "description", content: "Upload PDFs, render pages with PDF.js, and edit with a fabric.js overlay." },
      { property: "og:title", content: "Functional PDF Editor — DocuForge" },
      { property: "og:description", content: "A working browser PDF editor with upload, zoom, selection, drag, resize, annotations, and export." },
    ],
  }),
  component: FunctionalPdfEditor,
});
