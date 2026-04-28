import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FileText, Lock, Sparkles, Upload } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DocuForge PDF Editor" },
      { name: "description", content: "A premium browser-based PDF editor for teams." },
      { property: "og:title", content: "DocuForge PDF Editor" },
      { property: "og:description", content: "Edit, sign, annotate, and automate PDFs in the browser." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen bg-workspace text-foreground">
      <section className="mx-auto grid min-h-screen max-w-7xl items-center gap-10 px-4 py-10 md:px-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-panel px-4 py-2 text-sm font-semibold text-primary shadow-soft">
            <Sparkles className="size-4" /> Acrobat-style PDF SaaS
          </div>
          <h1 className="max-w-3xl text-5xl font-bold tracking-tight md:text-7xl">Edit PDFs directly in your browser.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
            Upload, edit text and images, annotate, sign, manage pages, use AI tools, and export secure production PDFs from one premium workspace.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/editor" className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-blue transition hover:-translate-y-0.5">
              Open editor <ArrowRight className="size-4" />
            </Link>
            <Link to="/dashboard" className="inline-flex items-center gap-2 rounded-xl border border-border bg-panel px-5 py-3 text-sm font-semibold shadow-soft transition hover:-translate-y-0.5 hover:bg-accent">
              View dashboard
            </Link>
          </div>
          <div className="mt-10 grid max-w-2xl gap-3 sm:grid-cols-3">
            {["500MB uploads", "OCR + AI chat", "Secure sharing"].map((item) => (
              <div key={item} className="rounded-2xl border border-border bg-panel p-4 shadow-soft">
                <p className="text-sm font-semibold">{item}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-panel p-4 shadow-page">
          <div className="rounded-2xl border border-border bg-editor p-4">
            <div className="mb-4 flex items-center justify-between rounded-xl bg-panel p-3 shadow-soft">
              <div className="flex items-center gap-2 text-sm font-semibold"><FileText className="size-4 text-primary" /> contract.pdf</div>
              <div className="flex gap-2"><Upload className="size-4 text-primary" /><Lock className="size-4 text-primary" /></div>
            </div>
            <div className="grid gap-4 md:grid-cols-[5rem_1fr_10rem]">
              <div className="space-y-3">
                {[1, 2, 3].map((n) => <div key={n} className="aspect-[3/4] rounded-lg bg-page shadow-soft" />)}
              </div>
              <div className="aspect-[1/1.3] rounded-sm bg-page p-8 shadow-page">
                <div className="mb-4 h-4 w-52 rounded bg-muted" />
                <div className="mb-2 h-2 rounded bg-muted" />
                <div className="mb-8 h-2 w-4/5 rounded bg-muted" />
                <div className="rounded-xl border-2 border-primary bg-primary/8 p-4 shadow-blue">
                  <p className="font-semibold">Editable text layer</p>
                  <p className="mt-2 text-sm text-muted-foreground">Bounding boxes, real-time preview, and version history.</p>
                </div>
              </div>
              <div className="hidden space-y-3 md:block">
                {["Font", "Color", "Layer", "Opacity"].map((p) => <div key={p} className="rounded-xl bg-panel p-3 text-sm font-semibold shadow-soft">{p}</div>)}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
