import { useEffect, useState, type ComponentType } from "react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Browser PDF Editor" },
      { name: "description", content: "A frontend-only PDF editor that runs entirely in your browser." },
      { property: "og:title", content: "Browser PDF Editor" },
      { property: "og:description", content: "Upload, render, annotate, manipulate objects, and export PDFs locally in the browser." },
    ],
  }),
  component: PdfEditorLoader,
});

function PdfEditorLoader() {
  const [Editor, setEditor] = useState<ComponentType | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("@/components/pdf-saas/FunctionalPdfEditor")
      .then((module) => {
        if (!cancelled) setEditor(() => module.FunctionalPdfEditor);
      })
      .catch((error) => {
        console.error("Editor failed to load", error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (Editor) return <Editor />;

  return (
    <main className="grid min-h-screen place-items-center bg-workspace px-4 text-foreground">
      <section className="w-full max-w-md rounded-xl border border-border bg-panel p-6 text-center shadow-soft">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground shadow-blue">PDF</div>
        <h1 className="text-xl font-semibold">Browser PDF Editor</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {failed ? "The editor could not load. Please refresh the preview." : "Loading editor tools..."}
        </p>
      </section>
    </main>
  );
}
