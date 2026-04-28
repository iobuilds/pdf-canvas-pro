import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import * as fabric from "fabric";
import {
  Circle,
  Crop,
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

type FabricJson = {
  version?: string;
  objects?: unknown[];
  [key: string]: unknown;
};

const SAMPLE_PDF_URL = "/2025_PHY_02.pdf";
const MAX_FILE_SIZE = 500 * 1024 * 1024;
const CANVAS_MAX_WIDTH = 980;
const MAIN_RECT_COLORS = ["#ffffff", "#000000", "#2563eb", "#dc2626", "#16a34a", "#facc15"];
const CROP_AREA_NAME = "export-crop-area";

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

function asFabricJson(json: unknown): FabricJson {
  if (json && typeof json === "object") return json as FabricJson;
  return { version: "6.0.0", objects: [] };
}

async function urlToArrayBuffer(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load the sample PDF.");
  return response.arrayBuffer();
}

const iconButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-panel px-3 text-sm font-semibold text-foreground shadow-soft transition hover:-translate-y-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45";
const activeButton = "bg-primary text-primary-foreground shadow-blue hover:bg-primary/90";
const uploadInputClass = "absolute inset-0 cursor-pointer opacity-0";

export function FunctionalPdfEditor() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayHostRef = useRef<HTMLDivElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const historyRef = useRef<Record<number, string[]>>({});
  const historyIndexRef = useRef<Record<number, number>>({});
  const renderTaskRef = useRef<RenderTask | null>(null);
  const pdfjsRef = useRef<PdfJsModule | null>(null);
  const skipHistoryRef = useRef(false);
  const toolRef = useRef<Tool>("select");

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
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [selectedObject, setSelectedObject] = useState<fabric.FabricObject | null>(null);
  const [searchText, setSearchText] = useState("");
  const [matches, setMatches] = useState<number[]>([]);
  const [rectFillColor, setRectFillColor] = useState("rgba(37, 99, 235, 0.18)");
  const [rectApplyAllPages, setRectApplyAllPages] = useState(false);
  const [pngPreviewUrl, setPngPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  useEffect(() => {
    pageStatesRef.current = pageStates;
  }, [pageStates]);

  useEffect(() => () => {
    if (pngPreviewUrl) URL.revokeObjectURL(pngPreviewUrl);
  }, [pngPreviewUrl]);

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

  const requireCanvas = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || !isEditorReady) {
      toast.error("PDF is still rendering. Try again in a moment.");
      return null;
    }
    return canvas;
  }, [isEditorReady]);

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
    if (!pdfDoc || !pdfCanvasRef.current || !overlayHostRef.current) return;
    setIsRendering(true);
    setIsEditorReady(false);
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

      const task = page.render({ canvas: null, canvasContext: context, viewport });
      renderTaskRef.current = task;
      await task.promise;
      renderTaskRef.current = null;

      const existing = fabricRef.current;
      if (existing) existing.dispose();

      const overlayHost = overlayHostRef.current;
      overlayHost.replaceChildren();
      overlayHost.style.width = `${Math.floor(viewport.width)}px`;
      overlayHost.style.height = `${Math.floor(viewport.height)}px`;
      const overlayCanvas = document.createElement("canvas");
      overlayHost.appendChild(overlayCanvas);
      overlayCanvasRef.current = overlayCanvas;
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
      const currentTool = toolRef.current;
      nextFabric.isDrawingMode = currentTool === "pen" || currentTool === "eraser";
      const fabricWrapper = nextFabric.wrapperEl;
      fabricWrapper.style.position = "absolute";
      fabricWrapper.style.inset = "0";
      fabricWrapper.style.width = `${Math.floor(viewport.width)}px`;
      fabricWrapper.style.height = `${Math.floor(viewport.height)}px`;
      fabricWrapper.style.pointerEvents = "auto";
      nextFabric.lowerCanvasEl.style.position = "absolute";
      nextFabric.upperCanvasEl.style.position = "absolute";
      if (currentTool === "eraser") {
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
      setIsEditorReady(true);
    } catch (error) {
      if (!(error instanceof Error && error.name === "RenderingCancelledException")) {
        toast.error(error instanceof Error ? error.message : "Could not render this page.");
      }
    } finally {
      setIsRendering(false);
    }
  }, [pdfDoc, pageNumber, pushHistory, zoom]);

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

  const handlePdfInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void validateAndLoadFile(file);
  }, [validateAndLoadFile]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDraggingOver(false);
    const file = event.dataTransfer.files[0];
    if (file) validateAndLoadFile(file);
  }, [validateAndLoadFile]);

  const addText = useCallback(() => {
    const canvas = requireCanvas();
    if (!canvas) return;
    const text = new fabric.IText("Edit text", {
      left: 140,
      top: 140,
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
  }, [requireCanvas]);

  const addRect = useCallback((highlight = false) => {
    const canvas = requireCanvas();
    if (!canvas) return;
    const width = highlight ? 260 : 180;
    const height = highlight ? 34 : 120;
    const left = Math.max(24, Math.round((canvas.getWidth() - width) / 2));
    const top = Math.max(24, Math.round((canvas.getHeight() - height) / 2));
    const rect = new fabric.Rect({
      left,
      top,
      width,
      height,
      fill: highlight ? "rgba(250, 204, 21, 0.45)" : rectFillColor,
      stroke: highlight ? "rgba(202, 138, 4, 0.8)" : "#2563eb",
      strokeWidth: highlight ? 0 : 2,
      cornerStyle: "circle",
      borderColor: "#2563eb",
      cornerColor: "#2563eb",
    });
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.requestRenderAll();
    if (!highlight && rectApplyAllPages && pageCount > 1) {
      const rectJson = rect.toObject();
      const nextState = { ...pageStatesRef.current };
      for (let page = 1; page <= pageCount; page += 1) {
        if (page === pageNumber) continue;
        const existingJson = asFabricJson(nextState[page]?.json);
        nextState[page] = {
          ...nextState[page],
          json: {
            ...existingJson,
            objects: [...(Array.isArray(existingJson?.objects) ? existingJson.objects : []), rectJson],
          },
        };
      }
      pageStatesRef.current = nextState;
      setPageStates(nextState);
      toast.success("Rectangle added to all pages");
    }
    setTool("select");
  }, [pageCount, pageNumber, rectApplyAllPages, rectFillColor, requireCanvas]);

  const applySelectedRectToAllPages = useCallback(() => {
    const canvas = requireCanvas();
    const active = canvas?.getActiveObject();
    if (!canvas || !active || active.type !== "rect" || pageCount <= 1) return;
    const rectJson = active.toObject();
    const nextState = { ...pageStatesRef.current };
    for (let page = 1; page <= pageCount; page += 1) {
      const currentJson = page === pageNumber ? canvas.toJSON() : nextState[page]?.json;
      const existingJson = asFabricJson(currentJson);
      nextState[page] = {
        ...nextState[page],
        json: page === pageNumber ? existingJson : {
          ...existingJson,
          objects: [...(Array.isArray(existingJson.objects) ? existingJson.objects : []), rectJson],
        },
      };
    }
    pageStatesRef.current = nextState;
    setPageStates(nextState);
    toast.success("Rectangle applied to every page");
  }, [pageCount, pageNumber, requireCanvas]);

  const addCircle = useCallback(() => {
    const canvas = requireCanvas();
    if (!canvas) return;
    const circle = new fabric.Circle({
      left: 150,
      top: 150,
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
  }, [requireCanvas]);

  const addCropArea = useCallback(() => {
    const canvas = requireCanvas();
    if (!canvas) return;
    canvas.getObjects().filter((object) => object.get("name") === CROP_AREA_NAME).forEach((object) => canvas.remove(object));
    const width = Math.min(360, Math.max(180, canvas.getWidth() - 80));
    const height = Math.min(240, Math.max(120, canvas.getHeight() - 80));
    const cropArea = new fabric.Rect({
      name: CROP_AREA_NAME,
      left: Math.max(24, Math.round((canvas.getWidth() - width) / 2)),
      top: Math.max(24, Math.round((canvas.getHeight() - height) / 2)),
      width,
      height,
      fill: "rgba(37, 99, 235, 0.08)",
      stroke: "#2563eb",
      strokeDashArray: [8, 6],
      strokeWidth: 2,
      cornerStyle: "circle",
      borderColor: "#2563eb",
      cornerColor: "#2563eb",
    });
    canvas.add(cropArea);
    canvas.setActiveObject(cropArea);
    canvas.requestRenderAll();
    setTool("select");
  }, [requireCanvas]);

  const addImageFromFile = useCallback(async (file: File) => {
    const canvas = requireCanvas();
    if (!canvas) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    const img = await fabric.FabricImage.fromURL(dataUrl, { crossOrigin: "anonymous" });
    img.set({ left: 140, top: 140, scaleX: 0.35, scaleY: 0.35, cornerStyle: "circle", borderColor: "#2563eb", cornerColor: "#2563eb" });
    canvas.add(img);
    canvas.setActiveObject(img);
    canvas.requestRenderAll();
    setTool("select");
  }, [requireCanvas]);

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
      const exportBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(exportBuffer).set(bytes);
      const blob = new Blob([exportBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName.replace(/\.pdf$/i, "-edited.pdf");
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Edited PDF exported");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export PDF.");
    } finally {
      setIsLoading(false);
    }
  }, [fileName, pageNumber, pdfBytes, pdfDoc, savePageState]);

  const downloadSelectedAreaPng = useCallback(() => {
    const pdfCanvas = pdfCanvasRef.current;
    const canvas = fabricRef.current;
    if (!pdfCanvas || !canvas) return;
    const active = canvas.getActiveObject();
    const cropArea = active?.get("name") === CROP_AREA_NAME ? active : canvas.getObjects().find((object) => object.get("name") === CROP_AREA_NAME);
    if (!cropArea) {
      toast.error("Select a crop area first.");
      return;
    }
    const rect = cropArea.getBoundingRect();
    const pixelRatioX = pdfCanvas.width / canvas.getWidth();
    const pixelRatioY = pdfCanvas.height / canvas.getHeight();
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = Math.max(1, Math.round(rect.width * pixelRatioX));
    exportCanvas.height = Math.max(1, Math.round(rect.height * pixelRatioY));
    const context = exportCanvas.getContext("2d");
    if (!context) return;
    context.drawImage(pdfCanvas, rect.left * pixelRatioX, rect.top * pixelRatioY, rect.width * pixelRatioX, rect.height * pixelRatioY, 0, 0, exportCanvas.width, exportCanvas.height);
    const overlayUrl = canvas.toDataURL({ format: "png", left: rect.left, top: rect.top, width: rect.width, height: rect.height, multiplier: pixelRatioX });
    const overlay = new Image();
    overlay.onload = () => {
      context.drawImage(overlay, 0, 0, exportCanvas.width, exportCanvas.height);
      exportCanvas.toBlob((blob) => {
        if (!blob) return;
        if (pngPreviewUrl) URL.revokeObjectURL(pngPreviewUrl);
        const url = URL.createObjectURL(blob);
        setPngPreviewUrl(url);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName.replace(/\.pdf$/i, `-page-${pageNumber}-area.png`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast.success("Selected area downloaded as PNG");
      }, "image/png");
    };
    overlay.src = overlayUrl;
  }, [fileName, pageNumber, pngPreviewUrl]);

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

  const setSelectedPosition = useCallback((axis: "left" | "top", value: number) => {
    const canvas = fabricRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !active || Number.isNaN(value)) return;
    active.set(axis, Math.max(0, value));
    active.setCoords();
    setSelectedObject(active);
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
      <header className="sticky top-0 z-30 border-b border-border bg-panel/95 shadow-soft backdrop-blur">
        <div className="flex h-16 items-center justify-between gap-3 px-3 md:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-blue">
              <FileText className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{fileName}</p>
              <p className="truncate text-xs text-muted-foreground">{pageCount ? `${pageCount} pages · local browser editing only` : "Upload a PDF to begin"}</p>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto px-2">
            <button className={`${iconButton} ${tool === "select" ? activeButton : ""}`} onClick={() => setTool("select")}><MousePointer2 className="size-4" />Select</button>
            <label className={`${iconButton} relative overflow-hidden`}><Upload className="size-4" />Upload<input ref={fileInputRef} className={uploadInputClass} type="file" accept="application/pdf,.pdf" onChange={handlePdfInputChange} /></label>
            <button className={iconButton} disabled={!isEditorReady} onClick={addText}><Type className="size-4" />Text</button>
            <label className={`${iconButton} relative overflow-hidden ${!isEditorReady ? "pointer-events-none opacity-45" : ""}`}><ImagePlus className="size-4" />Image<input ref={imageInputRef} className={uploadInputClass} type="file" accept="image/*" disabled={!isEditorReady} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void addImageFromFile(file); }} /></label>
            <button className={iconButton} disabled={!isEditorReady} onClick={() => addRect(false)}><Square className="size-4" />Rect</button>
            <button className={iconButton} disabled={!isEditorReady} onClick={addCircle}><Circle className="size-4" />Circle</button>
            <button className={iconButton} disabled={!isEditorReady} onClick={addCropArea}><Crop className="size-4" />Crop</button>
            <button className={iconButton} disabled={!isEditorReady} onClick={() => addRect(true)}><Highlighter className="size-4" />Highlight</button>
            <button className={`${iconButton} ${tool === "pen" ? activeButton : ""}`} disabled={!isEditorReady} onClick={() => setTool("pen")}><PenLine className="size-4" />Pen</button>
            <button className={`${iconButton} ${tool === "eraser" ? activeButton : ""}`} disabled={!isEditorReady} onClick={() => setTool("eraser")}><Eraser className="size-4" />Erase</button>
          </div>

          <div className="flex items-center gap-2">
            <button className={iconButton} onClick={() => applyHistory(-1)} aria-label="Undo"><Undo2 className="size-4" /></button>
            <button className={iconButton} onClick={() => applyHistory(1)} aria-label="Redo"><Redo2 className="size-4" /></button>
            <button className={iconButton} disabled={!isEditorReady} onClick={downloadSelectedAreaPng}><Crop className="size-4" />PNG</button>
            <button className={`${iconButton} ${activeButton}`} onClick={exportPdf}><Download className="size-4" />Export</button>
          </div>
        </div>
      </header>

      <section className="grid h-[calc(100vh-4rem)] grid-cols-1 lg:grid-cols-[14rem_minmax(0,1fr)_17rem]">
        <aside className="hidden overflow-y-auto border-r border-border bg-panel p-3 lg:block">
          <label className="relative mb-3 flex w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed border-primary/50 bg-primary/8 px-4 py-5 text-sm font-semibold transition hover:bg-primary/12">
            <Upload className="size-4" /> Upload PDF
            <input className={uploadInputClass} type="file" accept="application/pdf,.pdf" onChange={handlePdfInputChange} />
          </label>
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
              <div ref={overlayHostRef} className="absolute inset-0" />
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
            <div className="space-y-3 rounded-xl border border-border bg-surface p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rectangle fill</span>
                <input className="h-9 w-12 rounded-lg border border-border bg-panel p-1" type="color" value={rectFillColor.startsWith("#") ? rectFillColor : "#2563eb"} onChange={(event) => setRectFillColor(event.target.value)} />
              </div>
              <div className="grid grid-cols-6 gap-2">
                {MAIN_RECT_COLORS.map((color) => (
                  <button key={color} className={`h-8 rounded-lg border ${rectFillColor === color ? "border-primary ring-2 ring-ring" : "border-border"}`} style={{ backgroundColor: color }} onClick={() => setRectFillColor(color)} aria-label={`Choose rectangle fill ${color}`} />
                ))}
              </div>
              <button className={`${iconButton} w-full ${rectApplyAllPages ? activeButton : ""}`} type="button" onClick={() => setRectApplyAllPages((value) => !value)}>
                {rectApplyAllPages ? "All pages mode on" : "New rects: current page"}
              </button>
              <button className={iconButton + " w-full"} type="button" disabled={!selectedObject || selectedObject.type !== "rect" || pageCount <= 1} onClick={applySelectedRectToAllPages}>
                Apply selected rect to all pages
              </button>
            </div>
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Placement</span>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  X
                  <input className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" type="number" min="0" value={Math.round(selectedObject?.left ?? 0)} disabled={!selectedObject} onChange={(event) => setSelectedPosition("left", Number(event.target.value))} />
                </label>
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Y
                  <input className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" type="number" min="0" value={Math.round(selectedObject?.top ?? 0)} disabled={!selectedObject} onChange={(event) => setSelectedPosition("top", Number(event.target.value))} />
                </label>
              </div>
            </div>
            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Font size</span>
              <div className="grid grid-cols-4 gap-2">
                {[12, 20, 28, 48].map((size) => <button key={size} className={iconButton + " h-9 px-2"} disabled={!selectedObject || selectedObject.type !== "i-text"} onClick={() => setSelectedFontSize(size)}>{size}</button>)}
              </div>
            </label>
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Color</span>
              <div className="grid grid-cols-5 gap-2">
                {MAIN_RECT_COLORS.map((color) => (
                  <button key={color} className="h-8 rounded-lg border border-border" style={{ backgroundColor: color }} onClick={() => setSelectedColor(color)} aria-label={`Set color ${color}`} />
                ))}
              </div>
            </div>
            <button className="flex w-full items-center justify-center gap-2 rounded-xl bg-destructive px-4 py-3 text-sm font-semibold text-destructive-foreground shadow-soft transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-45" disabled={!selectedObject} onClick={deleteSelected}>
              <Trash2 className="size-4" /> Delete selected
            </button>
            <button className={iconButton + " w-full"} onClick={clearObjects}>Clear page overlay</button>
            <div className="rounded-xl bg-surface p-4 text-sm leading-6 text-muted-foreground">
              Everything runs locally in your browser. Double-click text to edit overlay text, drag objects to move, use handles to resize/rotate, and export to flatten edits into a new PDF.
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
