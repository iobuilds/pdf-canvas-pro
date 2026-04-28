import { createFileRoute } from "@tanstack/react-router";
import { FunctionalPdfEditor } from "@/components/pdf-saas/FunctionalPdfEditor";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Browser PDF Editor" },
      { name: "description", content: "A frontend-only PDF editor that runs entirely in your browser." },
      { property: "og:title", content: "Browser PDF Editor" },
      { property: "og:description", content: "Upload, render, annotate, manipulate objects, and export PDFs locally in the browser." },
    ],
  }),
  component: FunctionalPdfEditor,
});
