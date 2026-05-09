import { createFileRoute } from "@tanstack/react-router";
import { FunctionalPdfEditor } from "@/components/pdf-saas/FunctionalPdfEditor";
import { Monitor } from "lucide-react";

function EditorPage() {
  return (
    <>
      <div className="hidden lg:block">
        <FunctionalPdfEditor />
      </div>
      <div className="lg:hidden min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full text-center space-y-5 rounded-2xl border border-border bg-card p-8 shadow-soft">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <Monitor className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Desktop required</h1>
          <p className="text-sm text-muted-foreground">
            The PDF editor isn't supported on mobile or tablet devices yet. Please open
            this page on a desktop or laptop computer for the best experience.
          </p>
          <p className="text-xs text-muted-foreground">
            Recommended screen width: 1024px or larger.
          </p>
        </div>
      </div>
    </>
  );
}

export const Route = createFileRoute("/editor")({
  head: () => ({
    meta: [
      { title: "Functional PDF Editor — DocuForge" },
      { name: "description", content: "Upload PDFs, render pages with PDF.js, and edit with a fabric.js overlay." },
      { property: "og:title", content: "Functional PDF Editor — DocuForge" },
      { property: "og:description", content: "A working browser PDF editor with upload, zoom, selection, drag, resize, annotations, and export." },
    ],
  }),
  component: EditorPage,
});
