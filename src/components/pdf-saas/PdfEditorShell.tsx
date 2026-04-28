import { useMemo, useState } from "react";
import {
  Bot,
  CheckSquare,
  ChevronDown,
  Circle,
  Download,
  FileSearch,
  FileText,
  Highlighter,
  Image,
  Layers,
  MessageSquareText,
  MousePointer2,
  PenLine,
  Plus,
  Redo2,
  RotateCw,
  Save,
  Search,
  ShieldCheck,
  Shapes,
  Signature,
  Sparkles,
  Square,
  Type,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

const toolGroups = [
  { name: "Pages", icon: FileText, active: true, count: "12" },
  { name: "Annotations", icon: Highlighter, active: false, count: "8" },
  { name: "Shapes", icon: Shapes, active: false, count: "4" },
  { name: "Forms", icon: CheckSquare, active: false, count: "6" },
  { name: "OCR", icon: FileSearch, active: false, count: "Ready" },
  { name: "AI Tools", icon: Bot, active: false, count: "Pro" },
];

const toolbar = [
  { label: "Upload", icon: Upload, primary: true },
  { label: "Save", icon: Save },
  { label: "Undo", icon: Undo2, iconOnly: true },
  { label: "Redo", icon: Redo2, iconOnly: true },
  { label: "Add Text", icon: Type },
  { label: "Image", icon: Image },
  { label: "Highlight", icon: Highlighter },
  { label: "Sign", icon: Signature },
  { label: "Export", icon: Download, primary: true },
];

const pages = ["Cover", "Agreement", "Pricing", "Terms"];

function IconButton({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <button
      aria-label={label}
      className="grid size-9 place-items-center rounded-lg border border-border bg-panel text-muted-foreground shadow-soft transition hover:-translate-y-0.5 hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

export function PdfEditorShell() {
  const [selectedTool, setSelectedTool] = useState("Pages");
  const [zoom, setZoom] = useState(86);

  const status = useMemo(() => (zoom > 100 ? "High detail" : "Fast preview"), [zoom]);

  return (
    <main className="min-h-screen overflow-hidden bg-workspace text-foreground">
      <div className="editor-noise pointer-events-none fixed inset-0" />

      <header className="relative z-20 flex h-16 items-center justify-between border-b border-border bg-panel/95 px-4 shadow-soft backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-blue">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-5">DocuForge Editor</p>
            <p className="truncate text-xs text-muted-foreground">Contract-redline-final.pdf · Autosaved 12s ago</p>
          </div>
        </div>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Editor toolbar">
          {toolbar.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                className={
                  item.primary
                    ? "inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground shadow-blue transition hover:-translate-y-0.5 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    : "inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                }
              >
                <Icon className="size-4" />
                {!item.iconOnly && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <IconButton label="Zoom out">
            <ZoomOut className="size-4" />
          </IconButton>
          <div className="hidden h-9 items-center rounded-lg border border-border bg-surface px-3 text-sm font-semibold md:flex">
            {zoom}%
          </div>
          <IconButton label="Zoom in">
            <ZoomIn className="size-4" />
          </IconButton>
        </div>
      </header>

      <section className="relative z-10 grid h-[calc(100vh-4rem)] grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)_20rem]">
        <aside className="hidden border-r border-border bg-panel lg:block">
          <div className="flex h-full flex-col">
            <div className="border-b border-border p-4">
              <button className="flex w-full items-center justify-between rounded-xl border border-dashed border-primary/50 bg-primary/8 p-4 text-left transition hover:-translate-y-0.5 hover:bg-primary/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span>
                  <span className="block text-sm font-semibold">Drop PDFs here</span>
                  <span className="mt-1 block text-xs text-muted-foreground">500MB · multi-file</span>
                </span>
                <Plus className="size-5 text-primary" />
              </button>
            </div>

            <div className="space-y-2 p-3">
              {toolGroups.map((tool) => {
                const Icon = tool.icon;
                const active = selectedTool === tool.name;
                return (
                  <button
                    key={tool.name}
                    onClick={() => setSelectedTool(tool.name)}
                    className={
                      active
                        ? "flex w-full items-center justify-between rounded-xl bg-primary px-3 py-3 text-primary-foreground shadow-blue transition"
                        : "flex w-full items-center justify-between rounded-xl px-3 py-3 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                    }
                  >
                    <span className="flex items-center gap-3 text-sm font-medium">
                      <Icon className="size-4" />
                      {tool.name}
                    </span>
                    <span className="text-xs opacity-80">{tool.count}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-auto border-t border-border p-4">
              <div className="rounded-xl bg-surface p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="size-4 text-primary" />
                  AI actions
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Summarize, translate, OCR, and chat with this document from the AI panel.
                </p>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col bg-editor">
          <div className="flex h-12 items-center justify-between border-b border-border bg-panel px-4 lg:hidden">
            <button className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              <Upload className="size-4" /> Upload
            </button>
            <button className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium">
              Tools <ChevronDown className="size-4" />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[6.5rem_minmax(0,1fr)]">
            <div className="hidden overflow-y-auto border-r border-border bg-panel/80 p-3 md:block">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pages</p>
              <div className="space-y-3">
                {pages.map((page, index) => (
                  <button
                    key={page}
                    className={
                      index === 1
                        ? "group w-full rounded-lg border-2 border-primary bg-surface p-1 shadow-soft"
                        : "group w-full rounded-lg border border-border bg-surface p-1 transition hover:border-primary/50"
                    }
                  >
                    <div className="aspect-[3/4] rounded-md bg-page p-2">
                      <div className="mb-2 h-2 rounded bg-muted" />
                      <div className="space-y-1">
                        <div className="h-1 rounded bg-muted" />
                        <div className="h-1 rounded bg-muted" />
                        <div className="h-1 w-2/3 rounded bg-primary/35" />
                      </div>
                    </div>
                    <span className="mt-1 block text-[0.68rem] text-muted-foreground">{index + 1}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="relative min-w-0 overflow-auto p-4 md:p-8">
              <div className="mx-auto w-full max-w-4xl animate-editor-enter">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-panel px-3 py-2 text-sm text-muted-foreground shadow-soft">
                    <MousePointer2 className="size-4 text-primary" />
                    Selected text layer · {status}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setZoom((z) => Math.max(50, z - 10))} className="rounded-lg border border-border bg-panel px-3 py-2 text-sm font-medium transition hover:bg-accent">
                      -
                    </button>
                    <button onClick={() => setZoom((z) => Math.min(180, z + 10))} className="rounded-lg border border-border bg-panel px-3 py-2 text-sm font-medium transition hover:bg-accent">
                      +
                    </button>
                  </div>
                </div>

                <div className="relative mx-auto aspect-[1/1.32] max-h-[74vh] w-full max-w-[46rem] rounded-sm bg-page p-[7%] shadow-page ring-1 ring-border">
                  <div className="absolute left-[12%] top-[10%] h-4 w-52 rounded bg-muted" />
                  <div className="absolute left-[12%] top-[15%] h-2 w-80 rounded bg-muted" />
                  <div className="absolute left-[12%] top-[19%] h-2 w-72 rounded bg-muted" />

                  <div className="absolute left-[12%] top-[28%] w-[42%] rounded-lg border-2 border-primary bg-primary/8 p-3 shadow-blue transition hover:scale-[1.01]">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
                      <Type className="size-3" /> Editable text
                    </div>
                    <p className="text-sm font-semibold leading-5 text-foreground">Quarterly services agreement</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">Click to edit copy, font, size, color, or layer order.</p>
                  </div>

                  <div className="absolute right-[12%] top-[27%] h-[24%] w-[28%] rounded-lg border border-border bg-surface p-3">
                    <div className="grid h-full place-items-center rounded-md bg-primary/10 text-primary">
                      <Image className="size-10" />
                    </div>
                    <span className="absolute -right-2 -top-2 rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">Image</span>
                  </div>

                  <div className="absolute left-[12%] right-[12%] top-[57%] space-y-2">
                    {Array.from({ length: 8 }).map((_, index) => (
                      <div key={index} className="h-2 rounded bg-muted" style={{ width: `${92 - (index % 3) * 10}%` }} />
                    ))}
                  </div>

                  <div className="absolute bottom-[16%] left-[12%] flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-soft">
                    <Signature className="size-5 text-primary" />
                    <span className="text-sm font-semibold">Saved signature</span>
                  </div>

                  <div className="absolute bottom-[12%] right-[12%] flex gap-2">
                    <div className="h-10 w-16 rounded border-2 border-dashed border-primary/50" />
                    <Circle className="size-10 text-primary/60" />
                    <Square className="size-10 text-muted-foreground/50" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside className="hidden border-l border-border bg-panel xl:block">
          <div className="flex h-full flex-col">
            <div className="border-b border-border p-4">
              <p className="text-sm font-semibold">Properties</p>
              <p className="mt-1 text-xs text-muted-foreground">Layer: Editable text · Page 2</p>
            </div>

            <div className="space-y-5 overflow-y-auto p-4">
              <label className="block space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Font size</span>
                <input className="h-10 w-full rounded-lg border border-input bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ring" value="18 px" readOnly />
              </label>

              <div className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Color</span>
                <div className="grid grid-cols-5 gap-2">
                  {["bg-foreground", "bg-primary", "bg-destructive", "bg-muted", "bg-accent"].map((swatch) => (
                    <button key={swatch} className={`h-8 rounded-lg border border-border ${swatch}`} aria-label="Color swatch" />
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  ["X", "128"],
                  ["Y", "244"],
                  ["W", "304"],
                  ["H", "86"],
                ].map(([label, value]) => (
                  <label key={label} className="space-y-2">
                    <span className="text-xs font-semibold text-muted-foreground">{label}</span>
                    <input className="h-10 w-full rounded-lg border border-input bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ring" value={value} readOnly />
                  </label>
                ))}
              </div>

              <div className="rounded-xl bg-surface p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold">Opacity</span>
                  <span className="text-sm text-muted-foreground">100%</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div className="h-full w-full rounded-full bg-primary" />
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Layers className="size-4 text-primary" /> Layers
                </div>
                {["Editable text", "Hero image", "Signature", "Watermark"].map((layer, index) => (
                  <div key={layer} className="flex items-center justify-between border-t border-border py-3 text-sm first:border-t-0 first:pt-0 last:pb-0">
                    <span>{layer}</span>
                    <span className="text-xs text-muted-foreground">{index + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

export function DashboardShell() {
  const stats = ["24 PDFs", "7 signatures", "3.8GB stored", "99.9% uptime"];
  return (
    <main className="min-h-screen bg-workspace px-4 py-6 text-foreground md:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-primary">Workspace</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-5xl">PDF operations dashboard</h1>
          </div>
          <a href="/editor" className="rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-blue transition hover:-translate-y-0.5">Open editor</a>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat} className="rounded-2xl border border-border bg-panel p-5 shadow-soft">
              <p className="text-2xl font-bold">{stat}</p>
              <p className="mt-2 text-sm text-muted-foreground">Live workspace metric</p>
            </div>
          ))}
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <div className="rounded-2xl border border-border bg-panel p-6 shadow-soft">
            <h2 className="text-xl font-semibold">Recent projects</h2>
            {pages.map((page, index) => (
              <div key={page} className="mt-4 flex items-center justify-between rounded-xl bg-surface p-4">
                <span className="font-medium">{page} packet.pdf</span>
                <span className="text-sm text-muted-foreground">v{index + 3}</span>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-border bg-panel p-6 shadow-soft">
            <h2 className="text-xl font-semibold">Secure processing</h2>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <p className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /> Encrypted uploads</p>
              <p className="flex items-center gap-2"><RotateCw className="size-4 text-primary" /> 30 sec autosave</p>
              <p className="flex items-center gap-2"><MessageSquareText className="size-4 text-primary" /> Activity history</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
