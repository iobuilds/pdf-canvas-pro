import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FileSaver from "file-saver";
import { PDFDocument } from "pdf-lib";
import * as fabric from "fabric";
import {
  ArrowLeft,
  Circle,
  Download,
  Eraser,
  FileText,
  Highlighter,
  ImagePlus,
  Loader2,
  MousePointer2,
  PenLine,
  Redo2,
  RotateCw,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

type PdfJsModule = typeof import("pdfjs-dist");
type PdfDocumentProxy = import("pdfjs-dist").PDFDocumentProxy;
type RenderTask = import("pdfjs-dist").RenderTask;
type FabricCanvas = fabric.Canvas;
type Tool = "select" | "text" | "rect" | "circle" | "highlight" | "pen" | "eraser" | "image";

type PageState = {
  json: unknown | null;
  thumbnail?: string;
};

const SAMPLE_PDF_URL = "/2025_PHY_02.pdf";
const MAX_FILE_SIZE = 500 * 1024 * 1024;
const CANVAS_MAX_WIDTH = 980;

function readFileAsArrayBuffer(file: File) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("Could not read this PDF."));
    reader.readAsArrayBuffer(file);
  });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read this image."));
    reader.readAsDataURL(file);
  });
}

async function urlToArrayBuffer(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load the sample PDF.");
  return response.arrayBuffer();
}

const iconButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-panel px-3 text-sm font-semibold text-foreground shadow-soft transition hover:-translate-y-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45";
const activeButton = "bg-primary text-primary-foreground shadow-blue hover:bg-primary/90";

export function FunctionalPdfEditor() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const historyRef = useRef<Record<number, string[]>>({});
  const historyIndexRef = useRef<Record<number, number>>({});
  const renderTaskRef = useRef<RenderTask | null>(null);
  const pdfjsRef = useRef<PdfJsModule | null>(null);
  const skipHistoryRef = useRef(false);

  const [pdfDoc, setPdfDoc] = useState<PdfDocumentProxy | null>(null);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState("2025_PHY_02.pdf");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pageStates, setPageStates] = useState<Record<number, PageState>>({});
  const pageStatesRef = useRef<Record<number, PageState>>({});
  const [tool, setTool] = useState<Tool>("select");
  const [isLoading, setIsLoading] = useState(true);
  const [isRendering, setIsRendering] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [selectedObject, setSelectedObject] = useState<fabric.FabricObject | null>(null);
  const [searchText, setSearchText] = useState("");
  const [matches, setMatches] = useState<number[]>([]);

  useEffect(() => {
    pageStatesRef.current = pageStates;
  }, [pageStates]);

  const savePageState = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const json = canvas.toJSON();
    const nextState = {
      ...pageStatesRef.current,
      [pageNumber]: { ...pageStatesRef.current[pageNumber], json },
    };
    pageStatesRef.current = nextState;
    setPageStates(nextState);
  }, [pageNumber]);

  const pushHistory = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || skipHistoryRef.current) return;
    const next = JSON.stringify(canvas.toJSON());
    const stack = historyRef.current[pageNumber] ?? [];
    const currentIndex = historyIndexRef.current[pageNumber] ?? -1;
    const trimmed = stack.slice(0, currentIndex + 1);
    if (trimmed[trimmed.length - 1] === next) return;
    historyRef.current[pageNumber] = [...trimmed, next].slice(-60);
    historyIndexRef.current[pageNumber] = historyRef.current[pageNumber].length - 1;
    savePageState();
  }, [pageNumber, savePageState]);

  const applyHistory = useCallback(async (direction: -1 | 1) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const stack = historyRef.current[pageNumber] ?? [];
    const currentIndex = historyIndexRef.current[pageNumber] ?? -1;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= stack.length) return;
    skipHistoryRef.current = true;
    await canvas.loadFromJSON(JSON.parse(stack[nextIndex]));
    canvas.requestRenderAll();
    skipHistoryRef.current = false;
    historyIndexRef.current[pageNumber] = nextIndex;
    savePageState();
  }, [pageNumber, savePageState]);

  const renderPage = useCallback(async () => {
    if (!pdfDoc || !pdfCanvasRef.current || !overlayCanvasRef.current) return;
    setIsRendering(true);
    try {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      const page = await pdfDoc.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const fitScale = Math.min(CANVAS_MAX_WIDTH / baseViewport.width, 1.4);
      const scale = fitScale * zoom;
      const viewport = page.getViewport({ scale });
      const pixelRatio = window.devicePixelRatio || 1;
      const pdfCanvas = pdfCanvasRef.current;
      const context = pdfCanvas.getContext("2d");
      if (!context) return;

      pdfCanvas.width = Math.floor(viewport.width * pixelRatio);
      pdfCanvas.height = Math.floor(viewport.height * pixelRatio);
      pdfCanvas.style.width = `${Math.floor(viewport.width)}px`;
      pdfCanvas.style.height = `${Math.floor(viewport.height)}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, viewport.width, viewport.height);

      const task = page.render({ canvasContext: context, viewport });
      renderTaskRef.current = task;
      await task.promise;
      renderTaskRef.current = null;

      const existing = fabricRef.current;
      if (existing) existing.dispose();

      const overlayCanvas = overlayCanvasRef.current;
      overlayCanvas.width = Math.floor(viewport.width);
      overlayCanvas.height = Math.floor(viewport.height);
      overlayCanvas.style.width = `${Math.floor(viewport.width)}px`;
      overlayCanvas.style.height = `${Math.floor(viewport.height)}px`;

      const nextFabric = new fabric.Canvas(overlayCanvas, {
        width: viewport.width,
        height: viewport.height,
        preserveObjectStacking: true,
        selection: true,
      });
      nextFabric.backgroundColor = "transparent";
      nextFabric.freeDrawingBrush = new fabric.PencilBrush(nextFabric);
      nextFabric.freeDrawingBrush.color = "#2563eb";
      nextFabric.freeDrawingBrush.width = 3;
      nextFabric.isDrawingMode = tool === "pen" || tool === "eraser";
      if (tool === "eraser") {
        nextFabric.freeDrawingBrush.color = "#ffffff";
        nextFabric.freeDrawingBrush.width = 18;
      }

      fabricRef.current = nextFabric;

      const savedJson = pageStatesRef.current[pageNumber]?.json;
      if (savedJson) {
        skipHistoryRef.current = true;
        await nextFabric.loadFromJSON(savedJson);
        nextFabric.requestRenderAll();
        skipHistoryRef.current = false;
      } else if (!historyRef.current[pageNumber]) {
        const initial = JSON.stringify(nextFabric.toJSON());
        historyRef.current[pageNumber] = [initial];
        historyIndexRef.current[pageNumber] = 0;
      }

      nextFabric.on("selection:created", (event) => setSelectedObject(event.selected?.[0] ?? null));
      nextFabric.on("selection:updated", (event) => setSelectedObject(event.selected?.[0] ?? null));
      nextFabric.on("selection:cleared", () => setSelectedObject(null));
      nextFabric.on("object:added", pushHistory);
      nextFabric.on("object:modified", pushHistory);
      nextFabric.on("object:removed", pushHistory);
      nextFabric.on("path:created", pushHistory);
      nextFabric.on("mouse:dblclick", () => {
        const active = nextFabric.getActiveObject();
        if (active && active.type === "i-text") {
          (active as fabric.IText).enterEditing();
        }
      });
    } catch (error) {
      if (!(error instanceof Error && error.name === "RenderingCancelledException")) {
        toast.error(error instanceof Error ? error.message : "Could not render this page.");
      }
    } finally {
      setIsRendering(false);
    }
  }, [pdfDoc, pageNumber, pushHistory, tool, zoom]);

  const loadPdf = useCallback(async (source: ArrayBuffer, name: string) => {
    setIsLoading(true);
    try {
      const copy = source.slice(0);
      const pdfjs = pdfjsRef.current ?? (await import("pdfjs-dist"));
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      pdfjsRef.current = pdfjs;
      const doc = await pdfjs.getDocument({ data: copy.slice(0) }).promise;
      setPdfDoc(doc);
      setPdfBytes(source.slice(0));
      setFileName(name);
      setPageNumber(1);
      setPageCount(doc.numPages);
      pageStatesRef.current = {};
      setPageStates({});
      setMatches([]);
      historyRef.current = {};
      historyIndexRef.current = {};
      toast.success("PDF loaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid PDF file.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    urlToArrayBuffer(SAMPLE_PDF_URL)
      .then((buffer) => loadPdf(buffer, "2025_PHY_02.pdf"))
      .catch((error) => {
        setIsLoading(false);
        toast.error(error instanceof Error ? error.message : "Upload a PDF to begin.");
      });
  }, [loadPdf]);

  useEffect(() => {
    renderPage();
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [renderPage]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = tool === "pen" || tool === "eraser";
    canvas.selection = tool === "select";
    canvas.defaultCursor = tool === "select" ? "default" : "crosshair";
    canvas.getObjects().forEach((object) => {
      object.selectable = tool === "select";
      object.evented = tool === "select";
    });
    if (canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = tool === "eraser" ? "#ffffff" : "#2563eb";
      canvas.freeDrawingBrush.width = tool === "eraser" ? 18 : 3;
    }
    canvas.requestRenderAll();
  }, [tool]);

  const validateAndLoadFile = useCallback(async (file: File) => {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are supported.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error("PDF must be 500MB or smaller.");
      return;
    }
    const buffer = await readFileAsArrayBuffer(file);
    await loadPdf(buffer, file.name);
  }, [loadPdf]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDraggingOver(false);
    const file = event.dataTransfer.files[0];
    if (file) validateAndLoadFile(file);
  }, [validateAndLoadFile]);

  const addText = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const text = new fabric.IText("Edit text", {
      left: 80,
      top: 80,
      fill: "#111827",
      fontSize: 28,
      fontFamily: "Inter, Arial",
      padding: 8,
      cornerStyle: "circle",
      borderColor: "#2563eb",
      cornerColor: "#2563eb",
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    text.enterEditing();
    canvas.requestRenderAll();
    setTool("select");
  }, []);

  const addRect = useCallback((highlight = false) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const rect = new fabric.Rect({
      left: 90,
      top: 120,
      width: highlight ? 260 : 180,
      height: highlight ? 34 : 120,
      fill: highlight ? "rgba(250, 204, 21, 0.45)" : "rgba(37, 99, 235, 0.10)",
      stroke: highlight ? "rgba(202, 138, 4, 0.8)" : "#2563eb",
      strokeWidth: highlight ? 0 : 2,
      cornerStyle: "circle",
      borderColor: "#2563eb",
      cornerColor: "#2563eb",
    });
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.requestRenderAll();
    setTool("select");
  }, []);

  const addCircle = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const circle = new fabric.Circle({
      left: 110,
      top: 130,
      radius: 60,
      fill: "rgba(37, 99, 235, 0.10)",
      stroke: "#2563eb",
      strokeWidth: 2,
      cornerStyle: "circle",
      borderColor: "#2563eb",
      cornerColor: "#2563eb",
    });
    canvas.add(circle);
    canvas.setActiveObject(circle);
    canvas.requestRenderAll();
    setTool("select");
  }, []);

  const addImageFromFile = useCallback(async (file: File) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    const img = await fabric.FabricImage.fromURL(dataUrl, { crossOrigin: "anonymous" });
    img.set({ left: 100, top: 100, scaleX: 0.35, scaleY: 0.35, cornerStyle: "circle", borderColor: "#2563eb", cornerColor: "#2563eb" });
    canvas.add(img);
    canvas.setActiveObject(img);
    canvas.requestRenderAll();
    setTool("select");
  }, []);

  const deleteSelected = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    if (!active.length) return;
    active.forEach((object) => canvas.remove(object));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    setSelectedObject(null);
  }, []);

  const clearObjects = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.getObjects().forEach((object) => canvas.remove(object));
    canvas.requestRenderAll();
    setSelectedObject(null);
    toast.success("Page overlay cleared");
  }, []);

  const searchPdf = useCallback(async () => {
    if (!pdfDoc || !searchText.trim()) {
      setMatches([]);
      return;
    }
    const needle = searchText.trim().toLowerCase();
    const found: number[] = [];
    for (let pageIndex = 1; pageIndex <= pdfDoc.numPages; pageIndex += 1) {
      const page = await pdfDoc.getPage(pageIndex);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").toLowerCase();
      if (text.includes(needle)) found.push(pageIndex);
    }
    setMatches(found);
    if (found[0]) setPageNumber(found[0]);
    toast(found.length ? `Found on ${found.length} page${found.length === 1 ? "" : "s"}` : "No matches found");
  }, [pdfDoc, searchText]);

  const exportPdf = useCallback(async () => {
    if (!pdfBytes || !pdfDoc) return;
    savePageState();
    setIsLoading(true);
    try {
      const pdfLibDoc = await PDFDocument.load(pdfBytes.slice(0));
      for (let index = 0; index < pdfLibDoc.getPageCount(); index += 1) {
        const pageNum = index + 1;
        const state = pageNum === pageNumber ? fabricRef.current?.toJSON() : pageStatesRef.current[pageNum]?.json;
        if (!state) continue;
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const tempEl = document.createElement("canvas");
        const temp = new fabric.StaticCanvas(tempEl, { width: viewport.width, height: viewport.height });
        await temp.loadFromJSON(state);
        temp.renderAll();
        const dataUrl = temp.toDataURL({ format: "png", multiplier: 2 });
        temp.dispose();
        const image = await pdfLibDoc.embedPng(dataUrl);
        const pdfPage = pdfLibDoc.getPage(index);
        const { width, height } = pdfPage.getSize();
        pdfPage.drawImage(image, { x: 0, y: 0, width, height });
      }
      const bytes = await pdfLibDoc.save();
      FileSaver.saveAs(new Blob([bytes], { type: "application/pdf" }), fileName.replace(/\.pdf$/i, "-edited.pdf"));
      toast.success("Edited PDF exported");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export PDF.");
    } finally {
      setIsLoading(false);
    }
  }, [fileName, pageNumber, pdfBytes, pdfDoc, savePageState]);

  const setSelectedColor = useCallback((color: string) => {
    const canvas = fabricRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !active) return;
    active.set("fill", color);
    if (active.type !== "i-text") active.set("stroke", color);
    canvas.requestRenderAll();
    pushHistory();
  }, [pushHistory]);

  const setSelectedFontSize = useCallback((fontSize: number) => {
    const canvas = fabricRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !active || active.type !== "i-text") return;
    (active as fabric.IText).set("fontSize", fontSize);
    canvas.requestRenderAll();
    pushHistory();
  }, [pushHistory]);

  const selectedDescription = useMemo(() => {
    if (!selectedObject) return "No object selected";
    return `${selectedObject.type} · X ${Math.round(selectedObject.left ?? 0)} · Y ${Math.round(selectedObject.top ?? 0)}`;
  }, [selectedObject]);

  return (
    <main
      className={`min-h-screen bg-workspace text-foreground ${isDraggingOver ? "ring-4 ring-primary/40" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
    >
      <input ref={fileInputRef} className="hidden" type="file" accept="application/pdf,.pdf" onChange={(event) => event.target.files?.[0] && validateAndLoadFile(event.target.files[0])} />
      <input ref={imageInputRef} className="hidden" type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && addImageFromFile(event.target.files[0])} />

      <header className="sticky top-0 z-30 border-b border-border bg-panel/95 shadow-soft backdrop-blur">
        <div className="flex h-16 items-center justify-between gap-3 px-3 md:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <a href="/" className="hidden rounded-lg border border-border bg-surface p-2 transition hover:bg-accent md:inline-flex" aria-label="Back home">
              <ArrowLeft className="size-4" />
            </a>
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-blue">
              <FileText className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{fileName}</p>
              <p className="truncate text-xs text-muted-foreground">{pageCount ? `${pageCount} pages · fabric overlay active` : "Upload a PDF to begin"}</p>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto px-2">
            <button className={`${iconButton} ${tool === "select" ? activeButton : ""}`} onClick={() => setTool("select")}><MousePointer2 className="size-4" />Select</button>
            <button className={iconButton} onClick={() => fileInputRef.current?.click()}><Upload className="size-4" />Upload</button>
            <button className={iconButton} onClick={addText}><Type className="size-4" />Text</button>
            <button className={iconButton} onClick={() => imageInputRef.current?.click()}><ImagePlus className="size-4" />Image</button>
            <button className={iconButton} onClick={() => addRect(false)}><Square className="size-4" />Rect</button>
            <button className={iconButton} onClick={addCircle}><Circle className="size-4" />Circle</button>
            <button className={iconButton} onClick={() => addRect(true)}><Highlighter className="size-4" />Highlight</button>
            <button className={`${iconButton} ${tool === "pen" ? activeButton : ""}`} onClick={() => setTool("pen")}><PenLine className="size-4" />Pen</button>
            <button className={`${iconButton} ${tool === "eraser" ? activeButton : ""}`} onClick={() => setTool("eraser")}><Eraser className="size-4" />Erase</button>
          </div>

          <div className="flex items-center gap-2">
            <button className={iconButton} onClick={() => applyHistory(-1)} aria-label="Undo"><Undo2 className="size-4" /></button>
            <button className={iconButton} onClick={() => applyHistory(1)} aria-label="Redo"><Redo2 className="size-4" /></button>
            <button className={`${iconButton} ${activeButton}`} onClick={exportPdf}><Download className="size-4" />Export</button>
          </div>
        </div>
      </header>

      <section className="grid h-[calc(100vh-4rem)] grid-cols-1 lg:grid-cols-[14rem_minmax(0,1fr)_17rem]">
        <aside className="hidden overflow-y-auto border-r border-border bg-panel p-3 lg:block">
          <button className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/50 bg-primary/8 px-4 py-5 text-sm font-semibold transition hover:bg-primary/12" onClick={() => fileInputRef.current?.click()}>
            <Upload className="size-4" /> Upload PDF
          </button>
          <div className="mb-3 flex items-center gap-2">
            <input className="min-w-0 flex-1 rounded-lg border border-input bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Search text" value={searchText} onChange={(e) => setSearchText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchPdf()} />
            <button className={iconButton} onClick={searchPdf}>Go</button>
          </div>
          {matches.length > 0 && <p className="mb-3 text-xs text-muted-foreground">Matches: {matches.join(", ")}</p>}
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pages</p>
          <div className="space-y-2">
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
              <button key={page} className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left transition ${page === pageNumber ? "border-primary bg-primary/8" : "border-border bg-surface hover:border-primary/40"}`} onClick={() => { savePageState(); setPageNumber(page); }}>
                <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-page text-xs font-bold shadow-soft">{page}</div>
                <span className="text-sm font-medium">Page {page}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="relative min-w-0 overflow-auto bg-editor p-3 md:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-panel px-3 py-2 text-sm font-semibold shadow-soft">
              Page
              <input className="h-8 w-16 rounded-md border border-input bg-surface px-2 text-center outline-none focus:ring-2 focus:ring-ring" value={pageNumber} onChange={(e) => setPageNumber(Math.min(pageCount || 1, Math.max(1, Number(e.target.value) || 1)))} />
              <span className="text-muted-foreground">/ {pageCount || 1}</span>
            </div>
            <div className="flex items-center gap-2">
              <button className={iconButton} onClick={() => setZoom((z) => Math.max(0.35, Number((z - 0.1).toFixed(2))))}><ZoomOut className="size-4" /></button>
              <span className="w-20 rounded-lg border border-border bg-panel px-3 py-2 text-center text-sm font-semibold shadow-soft">{Math.round(zoom * 100)}%</span>
              <button className={iconButton} onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.1).toFixed(2))))}><ZoomIn className="size-4" /></button>
              <button className={iconButton} onClick={() => setZoom(1)}><RotateCw className="size-4" />Fit</button>
            </div>
          </div>

          <div className="mx-auto w-fit animate-editor-enter rounded-sm shadow-page">
            <div className="relative bg-page">
              <canvas ref={pdfCanvasRef} className="block" />
              <canvas ref={overlayCanvasRef} className="absolute inset-0 block" />
              {(isLoading || isRendering) && (
                <div className="absolute inset-0 grid place-items-center bg-panel/70 backdrop-blur-sm">
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-panel px-4 py-3 text-sm font-semibold shadow-soft">
                    <Loader2 className="size-4 animate-spin text-primary" /> Rendering PDF
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="hidden overflow-y-auto border-l border-border bg-panel p-4 lg:block">
          <div className="mb-5">
            <p className="text-sm font-semibold">Properties</p>
            <p className="mt-1 text-xs text-muted-foreground">{selectedDescription}</p>
          </div>
          <div className="space-y-5">
            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Font size</span>
              <select className="h-10 w-full rounded-lg border border-input bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ring" disabled={!selectedObject || selectedObject.type !== "i-text"} onChange={(e) => setSelectedFontSize(Number(e.target.value))} defaultValue="28">
                {[12, 16, 20, 24, 28, 36, 48, 64].map((size) => <option key={size} value={size}>{size}px</option>)}
              </select>
            </label>
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Color</span>
              <div className="grid grid-cols-5 gap-2">
                {["#111827", "#2563eb", "#dc2626", "#16a34a", "#facc15"].map((color) => (
                  <button key={color} className="h-8 rounded-lg border border-border" style={{ backgroundColor: color }} onClick={() => setSelectedColor(color)} aria-label={`Set color ${color}`} />
                ))}
              </div>
            </div>
            <button className="flex w-full items-center justify-center gap-2 rounded-xl bg-destructive px-4 py-3 text-sm font-semibold text-destructive-foreground shadow-soft transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-45" disabled={!selectedObject} onClick={deleteSelected}>
              <Trash2 className="size-4" /> Delete selected
            </button>
            <button className={iconButton + " w-full"} onClick={clearObjects}>Clear page overlay</button>
            <div className="rounded-xl bg-surface p-4 text-sm leading-6 text-muted-foreground">
              Double-click text to edit it. Drag objects to move; use corner handles to resize/rotate. Export flattens the overlay into the PDF.
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
