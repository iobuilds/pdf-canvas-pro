import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import * as fabric from "fabric";
import {
  Bold,
  Circle,
  ClipboardPaste,
  Copy,
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
  Scissors,
  Square,
  Trash2,
  Type,
  Underline,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDocumentProxy = import("pdfjs-dist/legacy/build/pdf.mjs").PDFDocumentProxy;
type RenderTask = import("pdfjs-dist/legacy/build/pdf.mjs").RenderTask;
type FabricCanvas = fabric.Canvas;
type Tool = "select" | "text" | "rect" | "circle" | "highlight" | "pen" | "eraser" | "image";

type PageState = {
  json: unknown | null;
  canvasWidth?: number;
  canvasHeight?: number;
  thumbnail?: string;
};

type PdfAreaClipboard = {
  sourceUrl: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

type PdfMetadata = {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
};

type FabricJson = {
  version?: string;
  objects?: unknown[];
  [key: string]: unknown;
};

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const CANVAS_MAX_WIDTH = 980;
const PDF_RENDER_TIMEOUT_MS = 7000;
const AREA_CLIPBOARD_MAX_DIMENSION = 8192;
const AREA_CLIPBOARD_MAX_PIXELS = 16_000_000;
const MAIN_RECT_COLORS = ["#ffffff", "#000000", "#2563eb", "#dc2626", "#16a34a", "#facc15"];
const SYSTEM_FONTS = [
  "Arial",
  "Arial Black",
  "Helvetica",
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Nunito",
  "Segoe UI",
  "Calibri",
  "Cambria",
  "Candara",
  "Consolas",
  "Constantia",
  "Corbel",
  "Times New Roman",
  "Georgia",
  "Garamond",
  "Palatino Linotype",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Impact",
  "Comic Sans MS",
  "Courier New",
  "Lucida Console",
  "Monaco",
  "Menlo",
  "Gill Sans",
  "Optima",
  "Avenir",
  "Futura",
  "Baskerville",
  "Didot",
  "Hoefler Text",
  "American Typewriter",
  "SF Pro Display",
  "SF Pro Text",
];
const CROP_AREA_NAME = "export-crop-area";
const EMPTY_PDF_METADATA: PdfMetadata = {
  title: "",
  author: "",
  subject: "",
  keywords: "",
  creator: "",
  producer: "",
};

type LocalFontEntry = {
  family: string;
  fullName?: string;
  postscriptName?: string;
  style?: string;
};

type FontAccessWindow = Window & {
  queryLocalFonts?: () => Promise<LocalFontEntry[]>;
};

function readFileAsArrayBuffer(file: File, onProgress?: (progress: number) => void) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("Could not read this PDF."));
    reader.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 90));
    };
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

function renderWithTimeout(task: RenderTask) {
  let timeoutId: number | null = null;
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutId = window.setTimeout(() => resolve("timeout"), PDF_RENDER_TIMEOUT_MS);
  });
  return Promise.race([task.promise.then(() => "done" as const), timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
}

function getCropExportRect(cropArea: fabric.FabricObject, canvas: FabricCanvas) {
  const left = Math.max(0, cropArea.left ?? 0);
  const top = Math.max(0, cropArea.top ?? 0);
  const width = Math.min(canvas.getWidth() - left, (cropArea.width ?? 0) * (cropArea.scaleX ?? 1));
  const height = Math.min(
    canvas.getHeight() - top,
    (cropArea.height ?? 0) * (cropArea.scaleY ?? 1),
  );

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function getSafeAreaCaptureScale(width: number, height: number, pixelRatioX: number, pixelRatioY: number) {
  const baseScale = Math.min(pixelRatioX, pixelRatioY);
  const scaledWidth = width * baseScale;
  const scaledHeight = height * baseScale;
  const dimensionLimit = AREA_CLIPBOARD_MAX_DIMENSION / Math.max(scaledWidth, scaledHeight, 1);
  const pixelLimit = Math.sqrt(AREA_CLIPBOARD_MAX_PIXELS / Math.max(scaledWidth * scaledHeight, 1));
  return baseScale * Math.min(1, dimensionLimit, pixelLimit);
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not copy the selected area."));
    }, "image/png");
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read the selected area."));
    image.src = src;
  });
}

function scaleCanvasObjects(canvas: fabric.StaticCanvas | FabricCanvas, fromWidth: number, fromHeight: number) {
  const toWidth = canvas.getWidth();
  const toHeight = canvas.getHeight();
  if (!fromWidth || !fromHeight || (fromWidth === toWidth && fromHeight === toHeight)) return;
  const scaleX = toWidth / fromWidth;
  const scaleY = toHeight / fromHeight;
  canvas.getObjects().forEach((object) => {
    object.set({
      left: (object.left ?? 0) * scaleX,
      top: (object.top ?? 0) * scaleY,
      scaleX: (object.scaleX ?? 1) * scaleX,
      scaleY: (object.scaleY ?? 1) * scaleY,
    });
    object.setCoords();
  });
}

const iconButton =
  "inline-flex h-10 w-10 items-center justify-center gap-2 rounded-lg border border-border bg-panel px-0 text-sm font-semibold text-foreground shadow-soft transition hover:-translate-y-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45 sm:w-auto sm:px-3";
const activeButton = "bg-primary text-primary-foreground shadow-blue hover:bg-primary/90";
const uploadInputClass = "absolute inset-0 cursor-pointer opacity-0";
const primaryActionButton = `${iconButton} bg-primary text-primary-foreground shadow-blue hover:bg-primary/90`;

export function FunctionalPdfEditor() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const overlayHostRef = useRef<HTMLDivElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const historyRef = useRef<Record<number, string[]>>({});
  const historyIndexRef = useRef<Record<number, number>>({});
  const renderTaskRef = useRef<RenderTask | null>(null);
  const thumbnailJobRef = useRef(0);
  const pdfjsRef = useRef<PdfJsModule | null>(null);
  const skipHistoryRef = useRef(false);
  const toolRef = useRef<Tool>("select");
  const pdfAreaClipboardRef = useRef<PdfAreaClipboard | null>(null);

  const [pdfDoc, setPdfDoc] = useState<PdfDocumentProxy | null>(null);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState("Upload a PDF");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pageStates, setPageStates] = useState<Record<number, PageState>>({});
  const pageStatesRef = useRef<Record<number, PageState>>({});
  const [tool, setTool] = useState<Tool>("select");
  const [isLoading, setIsLoading] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [selectedObject, setSelectedObject] = useState<fabric.FabricObject | null>(null);
  const [, setSelectionVersion] = useState(0);
  const [searchText, setSearchText] = useState("");
  const [matches, setMatches] = useState<number[]>([]);
  const [rectFillColor, setRectFillColor] = useState("rgba(37, 99, 235, 0.18)");
  const [pngPreviewUrl, setPngPreviewUrl] = useState<string | null>(null);
  const [availableFonts, setAvailableFonts] = useState(SYSTEM_FONTS);
  const [manualFontFamily, setManualFontFamily] = useState("");
  const [eraserSize, setEraserSize] = useState(18);
  const [hasPdfAreaClipboard, setHasPdfAreaClipboard] = useState(false);
  const [pdfMetadata, setPdfMetadata] = useState<PdfMetadata>(EMPTY_PDF_METADATA);

  const isUploading = isLoading && uploadProgress > 0 && uploadProgress < 100;

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  useEffect(() => {
    pageStatesRef.current = pageStates;
  }, [pageStates]);

  useEffect(
    () => () => {
      if (pngPreviewUrl) URL.revokeObjectURL(pngPreviewUrl);
    },
    [pngPreviewUrl],
  );

  const loadSystemFonts = useCallback(async () => {
    const queryLocalFonts = (window as FontAccessWindow).queryLocalFonts;
    if (!queryLocalFonts) {
      toast.info("Showing common system fonts supported by this browser.");
      return;
    }
    try {
      const fonts = await queryLocalFonts();
      const fontFamilies = fonts.map((font) => font.family).filter(Boolean);
      setAvailableFonts(Array.from(new Set([...SYSTEM_FONTS, ...fontFamilies])).sort());
      toast.success("System fonts loaded");
    } catch {
      toast.info("Font permission was not allowed. Showing common system fonts.");
    }
  }, []);

  const savePageState = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const json = canvas.toJSON();
    const nextState = {
      ...pageStatesRef.current,
      [pageNumber]: {
        ...pageStatesRef.current[pageNumber],
        json,
        canvasWidth: canvas.getWidth(),
        canvasHeight: canvas.getHeight(),
      },
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

  const applyHistory = useCallback(
    async (direction: -1 | 1) => {
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
    },
    [pageNumber, savePageState],
  );

  const generatePageThumbnails = useCallback(async (doc: PdfDocumentProxy) => {
    const jobId = (thumbnailJobRef.current += 1);
    for (let pageIndex = 1; pageIndex <= doc.numPages; pageIndex += 1) {
      if (thumbnailJobRef.current !== jobId) return;
      try {
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, pageIndex === 1 ? 100 : 20),
        );
        const page = await doc.getPage(pageIndex);
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(88 / viewport.width, 112 / viewport.height);
        const thumbnailViewport = page.getViewport({ scale });
        const thumbnailCanvas = document.createElement("canvas");
        const context = thumbnailCanvas.getContext("2d");
        if (!context) continue;
        thumbnailCanvas.width = Math.max(1, Math.floor(thumbnailViewport.width));
        thumbnailCanvas.height = Math.max(1, Math.floor(thumbnailViewport.height));
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
        await page.render({ canvas: thumbnailCanvas, viewport: thumbnailViewport }).promise;
        if (thumbnailJobRef.current !== jobId) return;
        const nextState = {
          ...pageStatesRef.current,
          [pageIndex]: {
            ...pageStatesRef.current[pageIndex],
            thumbnail: thumbnailCanvas.toDataURL("image/png"),
          },
        };
        pageStatesRef.current = nextState;
        setPageStates(nextState);
      } catch (error) {
        console.warn(`Could not render thumbnail for page ${pageIndex}`, error);
      }
    }
  }, []);

  useEffect(() => {
    if (!pdfDoc || !pageCount) return;
    if (
      Array.from({ length: pageCount }, (_, index) => index + 1).every(
        (page) => pageStatesRef.current[page]?.thumbnail,
      )
    ) {
      return;
    }
    void generatePageThumbnails(pdfDoc);
    return () => {
      thumbnailJobRef.current += 1;
    };
  }, [generatePageThumbnails, pageCount, pdfDoc]);

  const fitPageToWindow = useCallback(async () => {
    if (!pdfDoc || !workspaceRef.current) return;
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const baseFitScale = Math.min(CANVAS_MAX_WIDTH / viewport.width, 1.4);
    const availableWidth = Math.max(280, workspaceRef.current.clientWidth - 48);
    const availableHeight = Math.max(280, workspaceRef.current.clientHeight - 112);
    const nextZoom = Math.min(
      2.5,
      Math.max(
        0.35,
        Number(
          Math.min(
            availableWidth / (viewport.width * baseFitScale),
            availableHeight / (viewport.height * baseFitScale),
          ).toFixed(2),
        ),
      ),
    );
    setZoom(nextZoom);
  }, [pageNumber, pdfDoc]);

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
      const renderViewport = page.getViewport({ scale: scale * pixelRatio });
      const pdfCanvas = pdfCanvasRef.current;
      const context = pdfCanvas.getContext("2d");
      if (!context) return;

      pdfCanvas.width = Math.floor(renderViewport.width);
      pdfCanvas.height = Math.floor(renderViewport.height);
      pdfCanvas.style.width = `${Math.floor(viewport.width)}px`;
      pdfCanvas.style.height = `${Math.floor(viewport.height)}px`;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);

      const task = page.render({ canvas: pdfCanvas, viewport: renderViewport });
      renderTaskRef.current = task;
      const renderResult = await renderWithTimeout(task);
      if (renderResult === "timeout") {
        task.cancel();
        toast.warning("PDF preview is taking too long, but editing tools are ready.");
      }
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
      const currentTool = toolRef.current;
      nextFabric.freeDrawingBrush.color = "#2563eb";
      nextFabric.freeDrawingBrush.width = currentTool === "eraser" ? eraserSize : 3;
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
        nextFabric.freeDrawingBrush.width = eraserSize;
      }

      fabricRef.current = nextFabric;

      const savedJson = pageStatesRef.current[pageNumber]?.json;
      if (savedJson) {
        skipHistoryRef.current = true;
        await nextFabric.loadFromJSON(savedJson);
          const savedState = pageStatesRef.current[pageNumber];
          scaleCanvasObjects(
            nextFabric,
            savedState?.canvasWidth ?? viewport.width,
            savedState?.canvasHeight ?? viewport.height,
          );
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
        console.error("PDF render failed", error);
        toast.error(error instanceof Error ? error.message : "Could not render this page.");
      }
    } finally {
      setIsRendering(false);
    }
  }, [eraserSize, pdfDoc, pageNumber, pushHistory, zoom]);

  const loadPdf = useCallback(
    async (source: ArrayBuffer, name: string) => {
      setIsLoading(true);
      setUploadProgress((progress) => Math.max(progress, 92));
      try {
        const copy = source.slice(0);
        const pdfjs = pdfjsRef.current ?? (await import("pdfjs-dist/legacy/build/pdf.mjs"));
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        pdfjsRef.current = pdfjs;
        const doc = await pdfjs.getDocument({
          data: copy.slice(0),
          disableFontFace: true,
          isOffscreenCanvasSupported: false,
        }).promise;
        setPdfDoc(doc);
        setPdfBytes(source.slice(0));
        setFileName(name);
        setPageNumber(1);
        setPageCount(doc.numPages);
        pageStatesRef.current = {};
        setPageStates({});
        const pdfLibDoc = await PDFDocument.load(source.slice(0), { updateMetadata: false });
        setPdfMetadata({
          title: pdfLibDoc.getTitle() ?? "",
          author: pdfLibDoc.getAuthor() ?? "",
          subject: pdfLibDoc.getSubject() ?? "",
          keywords: pdfLibDoc.getKeywords() ?? "",
          creator: pdfLibDoc.getCreator() ?? "",
          producer: pdfLibDoc.getProducer() ?? "",
        });
        setMatches([]);
        historyRef.current = {};
        historyIndexRef.current = {};
        setUploadProgress(100);
        toast.success("PDF loaded");
        void generatePageThumbnails(doc);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Invalid PDF file.");
      } finally {
        setIsLoading(false);
        window.setTimeout(() => setUploadProgress(0), 600);
      }
    },
    [generatePageThumbnails],
  );

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
      canvas.freeDrawingBrush.width = tool === "eraser" ? eraserSize : 3;
    }
    canvas.requestRenderAll();
  }, [eraserSize, tool]);

  const validateAndLoadFile = useCallback(
    async (file: File) => {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        toast.error("Only PDF files are supported.");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error("PDF must be 500MB or smaller.");
        return;
      }
      setIsLoading(true);
      setUploadProgress(1);
      const buffer = await readFileAsArrayBuffer(file, setUploadProgress);
      await loadPdf(buffer, file.name);
    },
    [loadPdf],
  );

  const handlePdfInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) void validateAndLoadFile(file);
    },
    [validateAndLoadFile],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      setIsDraggingOver(false);
      const file = event.dataTransfer.files[0];
      if (file) validateAndLoadFile(file);
    },
    [validateAndLoadFile],
  );

  const addText = useCallback(async () => {
    await loadSystemFonts();
    const canvas = requireCanvas();
    if (!canvas) return;
    const text = new fabric.IText("Edit text", {
      left: 140,
      top: 140,
      fill: "#111827",
      fontSize: 28,
      fontFamily: "Arial",
      fontWeight: "normal",
      underline: false,
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
  }, [loadSystemFonts, requireCanvas]);

  const addRect = useCallback(
    (highlight = false) => {
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
      setTool("select");
    },
    [rectFillColor, requireCanvas],
  );

  const applySelectedObjectToAllPages = useCallback(() => {
    const canvas = requireCanvas();
    const active = canvas?.getActiveObject();
    if (!canvas || !active || active.get("name") === CROP_AREA_NAME || pageCount <= 1) return;
    active.setCoords();
    const objectJson = active.toObject();
    const currentPageJson = canvas.toJSON();
    const nextState = { ...pageStatesRef.current };
    for (let page = 1; page <= pageCount; page += 1) {
      const currentJson = page === pageNumber ? currentPageJson : nextState[page]?.json;
      const existingJson = asFabricJson(currentJson);
      nextState[page] = {
        ...nextState[page],
        canvasWidth: canvas.getWidth(),
        canvasHeight: canvas.getHeight(),
        json:
          page === pageNumber
            ? existingJson
            : {
                ...existingJson,
                objects: [
                  ...(Array.isArray(existingJson.objects) ? existingJson.objects : []),
                  objectJson,
                ],
              },
      };
    }
    pageStatesRef.current = nextState;
    setPageStates(nextState);
    toast.success("Selected element applied to every page");
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
    canvas
      .getObjects()
      .filter((object) => object.get("name") === CROP_AREA_NAME)
      .forEach((object) => canvas.remove(object));
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

  const copySelectedPdfArea = useCallback(
    (cut = false) => {
      const pdfCanvas = pdfCanvasRef.current;
      const canvas = fabricRef.current;
      if (!pdfCanvas || !canvas) return;
      const active =
        canvas.getActiveObject()?.get("name") === CROP_AREA_NAME
          ? canvas.getActiveObject()
          : canvas.getObjects().find((object) => object.get("name") === CROP_AREA_NAME);
      if (!active) {
        toast.error("Select an area first.");
        return;
      }
      const rect = getCropExportRect(active, canvas);
      const pixelRatioX = pdfCanvas.width / canvas.getWidth();
      const pixelRatioY = pdfCanvas.height / canvas.getHeight();
      const areaCanvas = document.createElement("canvas");
      areaCanvas.width = Math.max(1, Math.round(rect.width * pixelRatioX));
      areaCanvas.height = Math.max(1, Math.round(rect.height * pixelRatioY));
      const context = areaCanvas.getContext("2d");
      if (!context) return;
      context.drawImage(
        pdfCanvas,
        rect.left * pixelRatioX,
        rect.top * pixelRatioY,
        rect.width * pixelRatioX,
        rect.height * pixelRatioY,
        0,
        0,
        areaCanvas.width,
        areaCanvas.height,
      );
      pdfAreaClipboardRef.current = {
        dataUrl: areaCanvas.toDataURL("image/png"),
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
      setHasPdfAreaClipboard(true);
      if (cut) {
        active.set({ fill: "#ffffff", stroke: "#ffffff", strokeDashArray: undefined });
        canvas.requestRenderAll();
        pushHistory();
      }
      toast.success(cut ? "Area cut. Paste it on any page." : "Area copied. Paste it on any page.");
    },
    [pushHistory],
  );

  const pastePdfArea = useCallback(async () => {
    const canvas = requireCanvas();
    const clipboard = pdfAreaClipboardRef.current;
    if (!canvas || !clipboard) return;
    const image = await fabric.FabricImage.fromURL(clipboard.dataUrl, { crossOrigin: "anonymous" });
    image.set({
      left: Math.min(Math.max(0, clipboard.left), Math.max(0, canvas.getWidth() - clipboard.width)),
      top: Math.min(Math.max(0, clipboard.top), Math.max(0, canvas.getHeight() - clipboard.height)),
      scaleX: clipboard.width / (image.width || clipboard.width),
      scaleY: clipboard.height / (image.height || clipboard.height),
      lockScalingX: true,
      lockScalingY: true,
      lockUniScaling: true,
      cornerStyle: "circle",
      borderColor: "#2563eb",
      cornerColor: "#2563eb",
    });
    canvas.add(image);
    canvas.setActiveObject(image);
    canvas.requestRenderAll();
    setSelectedObject(image);
    setTool("select");
  }, [requireCanvas]);

  const addImageFromFile = useCallback(
    async (file: File) => {
      const canvas = requireCanvas();
      if (!canvas) return;
      if (!file.type.startsWith("image/")) {
        toast.error("Please choose an image file.");
        return;
      }
      const dataUrl = await readFileAsDataUrl(file);
      const img = await fabric.FabricImage.fromURL(dataUrl, { crossOrigin: "anonymous" });
      img.set({
        left: 140,
        top: 140,
        scaleX: 0.35,
        scaleY: 0.35,
        cornerStyle: "circle",
        borderColor: "#2563eb",
        cornerColor: "#2563eb",
      });
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.requestRenderAll();
      setTool("select");
    },
    [requireCanvas],
  );

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (isTyping) return;

      const canvas = fabricRef.current;
      const activeObjects = canvas?.getActiveObjects() ?? [];
      if (!canvas) return;

      if (!activeObjects.length) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
          event.preventDefault();
          void pastePdfArea();
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          savePageState();
          setPageNumber((page) =>
            event.key === "ArrowLeft" ? Math.max(1, page - 1) : Math.min(pageCount || 1, page + 1),
          );
        }
        return;
      }

      const activeText = canvas.getActiveObject();
      if (activeText?.type === "i-text" && (activeText as fabric.IText).isEditing) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelected();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelectedPdfArea(false);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x") {
        event.preventDefault();
        copySelectedPdfArea(true);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
        event.preventDefault();
        void pastePdfArea();
        return;
      }

      const arrowMove: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };
      const direction = arrowMove[event.key];
      if (!direction) return;

      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 10 : 1;
      activeObjects.forEach((object) => {
        object.set({
          left: Math.max(0, (object.left ?? 0) + direction[0] * step),
          top: Math.max(0, (object.top ?? 0) + direction[1] * step),
        });
        object.setCoords();
      });
      canvas.requestRenderAll();
      setSelectedObject(canvas.getActiveObject() ?? activeObjects[0] ?? null);
      setSelectionVersion((value) => value + 1);
      pushHistory();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [copySelectedPdfArea, deleteSelected, pageCount, pastePdfArea, pushHistory, savePageState]);

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
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .toLowerCase();
      if (text.includes(needle)) found.push(pageIndex);
    }
    setMatches(found);
    if (found[0]) setPageNumber(found[0]);
    toast(
      found.length
        ? `Found on ${found.length} page${found.length === 1 ? "" : "s"}`
        : "No matches found",
    );
  }, [pdfDoc, searchText]);

  const exportPdf = useCallback(async () => {
    if (!pdfBytes || !pdfDoc) return;
    savePageState();
    setIsLoading(true);
    try {
      const pdfLibDoc = await PDFDocument.load(pdfBytes.slice(0));
      pdfLibDoc.setTitle(pdfMetadata.title);
      pdfLibDoc.setAuthor(pdfMetadata.author);
      pdfLibDoc.setSubject(pdfMetadata.subject);
      pdfLibDoc.setKeywords(pdfMetadata.keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean));
      pdfLibDoc.setCreator(pdfMetadata.creator);
      pdfLibDoc.setProducer(pdfMetadata.producer);
      for (let index = 0; index < pdfLibDoc.getPageCount(); index += 1) {
        const pageNum = index + 1;
        const savedPageState = pageStatesRef.current[pageNum];
        const isCurrentPage = pageNum === pageNumber;
        const state = isCurrentPage ? fabricRef.current?.toJSON() : savedPageState?.json;
        if (!state) continue;
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const sourceWidth = isCurrentPage
          ? (fabricRef.current?.getWidth() ?? viewport.width)
          : (savedPageState?.canvasWidth ?? viewport.width);
        const sourceHeight = isCurrentPage
          ? (fabricRef.current?.getHeight() ?? viewport.height)
          : (savedPageState?.canvasHeight ?? viewport.height);
        const tempEl = document.createElement("canvas");
        const temp = new fabric.StaticCanvas(tempEl, {
          width: sourceWidth,
          height: sourceHeight,
        });
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
  }, [fileName, pageNumber, pdfBytes, pdfDoc, pdfMetadata, savePageState]);

  const downloadSelectedAreaPng = useCallback(() => {
    const pdfCanvas = pdfCanvasRef.current;
    const canvas = fabricRef.current;
    if (!pdfCanvas || !canvas) return;
    const active = canvas.getActiveObject();
    const cropArea =
      active?.get("name") === CROP_AREA_NAME
        ? active
        : canvas.getObjects().find((object) => object.get("name") === CROP_AREA_NAME);
    if (!cropArea) {
      toast.error("Select a crop area first.");
      return;
    }
    const rect = getCropExportRect(cropArea, canvas);
    const pixelRatioX = pdfCanvas.width / canvas.getWidth();
    const pixelRatioY = pdfCanvas.height / canvas.getHeight();
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = Math.max(1, Math.round(rect.width * pixelRatioX));
    exportCanvas.height = Math.max(1, Math.round(rect.height * pixelRatioY));
    const context = exportCanvas.getContext("2d");
    if (!context) return;
    context.drawImage(
      pdfCanvas,
      rect.left * pixelRatioX,
      rect.top * pixelRatioY,
      rect.width * pixelRatioX,
      rect.height * pixelRatioY,
      0,
      0,
      exportCanvas.width,
      exportCanvas.height,
    );
    const wasCropVisible = cropArea.visible;
    cropArea.set("visible", false);
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    const overlayUrl = canvas.toDataURL({
      format: "png",
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      multiplier: pixelRatioX,
    });
    cropArea.set("visible", wasCropVisible);
    if (active) canvas.setActiveObject(active);
    canvas.requestRenderAll();
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

  const setSelectedColor = useCallback(
    (color: string) => {
      const canvas = fabricRef.current;
      const active = canvas?.getActiveObject();
      if (!canvas || !active) return;
      active.set("fill", color);
      if (active.type !== "i-text") active.set("stroke", color);
      canvas.requestRenderAll();
      pushHistory();
    },
    [pushHistory],
  );

  const setSelectedFontSize = useCallback(
    (fontSize: number) => {
      const canvas = fabricRef.current;
      const active = canvas?.getActiveObject();
      if (!canvas || !active || active.type !== "i-text") return;
      (active as fabric.IText).set("fontSize", fontSize);
      canvas.requestRenderAll();
      setSelectedObject(active);
      setSelectionVersion((value) => value + 1);
      pushHistory();
    },
    [pushHistory],
  );

  const setSelectedFontFamily = useCallback(
    (fontFamily: string) => {
      const canvas = fabricRef.current;
      const active = canvas?.getActiveObject();
      if (!canvas || !active || active.type !== "i-text") return;
      if (fontFamily && !availableFonts.includes(fontFamily)) {
        setAvailableFonts((fonts) => Array.from(new Set([...fonts, fontFamily])).sort());
      }
      (active as fabric.IText).set("fontFamily", fontFamily);
      canvas.requestRenderAll();
      setSelectedObject(active);
      setSelectionVersion((value) => value + 1);
      pushHistory();
    },
    [availableFonts, pushHistory],
  );

  const updatePdfMetadata = useCallback((field: keyof PdfMetadata, value: string) => {
    setPdfMetadata((metadata) => ({ ...metadata, [field]: value }));
  }, []);

  const clearPdfMetadata = useCallback(() => {
    setPdfMetadata(EMPTY_PDF_METADATA);
    toast.success("PDF metadata cleared");
  }, []);

  const toggleSelectedTextStyle = useCallback(
    (style: "bold" | "underline") => {
      const canvas = fabricRef.current;
      const active = canvas?.getActiveObject();
      if (!canvas || !active || active.type !== "i-text") return;
      const text = active as fabric.IText;
      if (style === "bold") {
        text.set("fontWeight", text.fontWeight === "bold" ? "normal" : "bold");
      } else {
        text.set("underline", !text.underline);
      }
      canvas.requestRenderAll();
      setSelectedObject(active);
      setSelectionVersion((value) => value + 1);
      pushHistory();
    },
    [pushHistory],
  );

  const setSelectedPosition = useCallback(
    (axis: "left" | "top", value: number) => {
      const canvas = fabricRef.current;
      const active = canvas?.getActiveObject();
      if (!canvas || !active || Number.isNaN(value)) return;
      active.set(axis, Math.max(0, value));
      active.setCoords();
      setSelectedObject(active);
      setSelectionVersion((value) => value + 1);
      canvas.requestRenderAll();
      pushHistory();
    },
    [pushHistory],
  );

  const selectedDescription = useMemo(() => {
    if (!selectedObject) return "No object selected";
    return `${selectedObject.type} · X ${Math.round(selectedObject.left ?? 0)} · Y ${Math.round(selectedObject.top ?? 0)}`;
  }, [selectedObject]);

  const selectedText = selectedObject?.type === "i-text" ? (selectedObject as fabric.IText) : null;

  return (
    <main
      className={`min-h-screen overflow-x-hidden bg-workspace text-foreground ${isDraggingOver ? "ring-4 ring-primary/40" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
    >
      <header className="sticky top-0 z-30 border-b border-border bg-panel/95 shadow-soft backdrop-blur">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-2 px-3 py-2 md:gap-3 md:px-5">
          <div className="order-1 flex min-w-0 flex-1 items-center gap-3 sm:flex-none">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-blue">
              <FileText className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{fileName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {pageCount
                  ? `${pageCount} pages · local browser editing only`
                  : "Upload a PDF to begin"}
              </p>
            </div>
          </div>

          <div className="order-3 grid w-full grid-cols-8 gap-1 sm:order-2 sm:flex sm:w-auto sm:min-w-0 sm:flex-1 sm:items-center sm:justify-center sm:overflow-x-auto sm:px-2 [&>button]:min-w-0 [&>label]:min-w-0 sm:[&>button]:shrink-0 sm:[&>label]:shrink-0">
            <button
              className={`${iconButton} ${tool === "select" ? activeButton : ""}`}
              onClick={() => setTool("select")}
            >
              <MousePointer2 className="size-4" />
              <span className="hidden sm:inline">Select</span>
            </button>
            <label className={`${iconButton} relative overflow-hidden`}>
              <Upload className="size-4" />
              <span className="hidden sm:inline">Upload</span>
              <input
                ref={fileInputRef}
                className={uploadInputClass}
                type="file"
                accept="application/pdf,.pdf"
                onChange={handlePdfInputChange}
              />
            </label>
            <button className={iconButton} disabled={!isEditorReady} onClick={addText}>
              <Type className="size-4" />
              <span className="hidden sm:inline">Text</span>
            </button>
            <label
              className={`${iconButton} relative overflow-hidden ${!isEditorReady ? "pointer-events-none opacity-45" : ""}`}
            >
              <ImagePlus className="size-4" />
              <span className="hidden sm:inline">Image</span>
              <input
                ref={imageInputRef}
                className={uploadInputClass}
                type="file"
                accept="image/*"
                disabled={!isEditorReady}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void addImageFromFile(file);
                }}
              />
            </label>
            <button className={iconButton} disabled={!isEditorReady} onClick={() => addRect(false)}>
              <Square className="size-4" />
              <span className="hidden sm:inline">Rect</span>
            </button>
            <button className={iconButton} disabled={!isEditorReady} onClick={addCircle}>
              <Circle className="size-4" />
              <span className="hidden sm:inline">Circle</span>
            </button>
            <button className={iconButton} disabled={!isEditorReady} onClick={addCropArea}>
              <Crop className="size-4" />
              <span className="hidden sm:inline">Area</span>
            </button>
            <button className={iconButton} disabled={!isEditorReady} onClick={() => addRect(true)}>
              <Highlighter className="size-4" />
              <span className="hidden sm:inline">Highlight</span>
            </button>
            <button
              className={`${iconButton} ${tool === "pen" ? activeButton : ""}`}
              disabled={!isEditorReady}
              onClick={() => setTool("pen")}
            >
              <PenLine className="size-4" />
              <span className="hidden sm:inline">Pen</span>
            </button>
            <button
              className={`${iconButton} ${tool === "eraser" ? activeButton : ""}`}
              disabled={!isEditorReady}
              onClick={() => setTool("eraser")}
            >
              <Eraser className="size-4" />
              <span className="hidden sm:inline">Erase</span>
            </button>
            {tool === "eraser" && (
              <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-panel px-3 text-xs font-semibold text-muted-foreground shadow-soft">
                Size
                <input
                  className="h-7 w-16 rounded-md border border-input bg-surface px-2 text-center text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                  type="number"
                  min="4"
                  max="80"
                  value={eraserSize}
                  onChange={(event) => setEraserSize(Math.min(80, Math.max(4, Number(event.target.value) || 4)))}
                />
              </label>
            )}
          </div>

          <div className="order-2 flex max-w-full items-center gap-2 sm:order-3 [&>button]:shrink-0">
            <button className={iconButton} onClick={() => applyHistory(-1)} aria-label="Undo">
              <Undo2 className="size-4" />
            </button>
            <button className={iconButton} onClick={() => applyHistory(1)} aria-label="Redo">
              <Redo2 className="size-4" />
            </button>
            <button
              className={primaryActionButton}
              disabled={!isEditorReady}
              onClick={downloadSelectedAreaPng}
            >
              <Crop className="size-4" />
              <span className="hidden md:inline">Download area PNG</span>
            </button>
            <button className={primaryActionButton} onClick={exportPdf}>
              <Download className="size-4" />
              <span className="hidden sm:inline">Export PDF</span>
            </button>
          </div>
        </div>
        {uploadProgress > 0 && (
          <div className="h-1 w-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        )}
      </header>

      <section className="grid min-h-[calc(100vh-4rem)] grid-cols-1 lg:h-[calc(100vh-4rem)] lg:grid-cols-[14rem_minmax(0,1fr)_17rem]">
        <aside className="order-2 max-h-56 overflow-y-auto border-t border-border bg-panel p-3 lg:order-none lg:block lg:max-h-none lg:border-r lg:border-t-0">
          <label className="relative mb-3 flex w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed border-primary/50 bg-primary/8 px-4 py-5 text-sm font-semibold transition hover:bg-primary/12">
            <Upload className="size-4" /> Upload PDF
            <input
              className={uploadInputClass}
              type="file"
              accept="application/pdf,.pdf"
              onChange={handlePdfInputChange}
            />
          </label>
          <div className="mb-3 flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-input bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="Search text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchPdf()}
            />
            <button className={iconButton} onClick={searchPdf}>
              Go
            </button>
          </div>
          {matches.length > 0 && (
            <p className="mb-3 text-xs text-muted-foreground">Matches: {matches.join(", ")}</p>
          )}
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pages
          </p>
          <div className="space-y-2">
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
              <button
                key={page}
                className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left transition ${page === pageNumber ? "border-primary bg-primary/8" : "border-border bg-surface hover:border-primary/40"}`}
                onClick={() => {
                  savePageState();
                  setPageNumber(page);
                }}
              >
                <div className="grid h-16 w-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-page text-xs font-bold shadow-soft">
                  {pageStates[page]?.thumbnail ? (
                    <img
                      className="h-full w-full object-contain"
                      src={pageStates[page]?.thumbnail}
                      alt={`Page ${page} thumbnail`}
                      loading="lazy"
                    />
                  ) : (
                    page
                  )}
                </div>
                <span className="text-sm font-medium">Page {page}</span>
              </button>
            ))}
          </div>
        </aside>

        <div ref={workspaceRef} className="relative order-1 flex min-h-[60vh] min-w-0 flex-col overflow-auto bg-editor p-3 md:p-6 lg:order-none lg:min-h-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-panel px-3 py-2 text-sm font-semibold shadow-soft">
              Page
              <input
                className="h-8 w-16 rounded-md border border-input bg-surface px-2 text-center outline-none focus:ring-2 focus:ring-ring"
                value={pageNumber}
                onChange={(e) =>
                  setPageNumber(Math.min(pageCount || 1, Math.max(1, Number(e.target.value) || 1)))
                }
              />
              <span className="text-muted-foreground">/ {pageCount || 1}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                className={iconButton}
                onClick={() => setZoom((z) => Math.max(0.35, Number((z - 0.1).toFixed(2))))}
              >
                <ZoomOut className="size-4" />
              </button>
              <span className="w-20 rounded-lg border border-border bg-panel px-3 py-2 text-center text-sm font-semibold shadow-soft">
                {Math.round(zoom * 100)}%
              </span>
              <button
                className={iconButton}
                onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.1).toFixed(2))))}
              >
                <ZoomIn className="size-4" />
              </button>
              <button
                className={iconButton}
                disabled={!pdfDoc}
                onClick={() => void fitPageToWindow()}
              >
                <RotateCw className="size-4" />
                <span className="hidden sm:inline">Fit</span>
              </button>
            </div>
          </div>

          <div className="grid min-h-[calc(100%-4.5rem)] min-w-full flex-1 place-items-center overflow-auto py-4 md:min-w-max md:py-6">
            <div className="w-fit animate-editor-enter rounded-sm shadow-page">
              <div className="relative bg-page">
                <canvas ref={pdfCanvasRef} className="block" />
                <div ref={overlayHostRef} className="absolute inset-0" />
                {!pdfDoc && !isLoading && (
                  <div className="absolute inset-0 grid place-items-center p-6 text-center">
                    <div className="space-y-2">
                      <p className="text-lg font-bold text-foreground">PDF Editor v1.0</p>
                      <p className="text-sm font-medium text-muted-foreground">Drop PDF here to start editing</p>
                    </div>
                  </div>
                )}
                {(isLoading || isRendering) && (
                  <div className="absolute inset-0 grid place-items-center bg-panel/70 backdrop-blur-sm">
                    <div className="min-w-56 rounded-xl border border-border bg-panel px-4 py-3 text-sm font-semibold shadow-soft">
                      <div className="flex items-center gap-3">
                        <Loader2 className="size-4 animate-spin text-primary" />
                        {isUploading ? `Uploading ${uploadProgress}%` : "Rendering PDF"}
                      </div>
                      {isUploading && (
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-300"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <aside className="order-3 overflow-y-auto border-t border-border bg-panel p-3 sm:p-4 lg:order-none lg:block lg:border-l lg:border-t-0">
          <div className="sticky top-0 z-10 -mx-3 -mt-3 border-b border-border bg-panel/95 px-3 py-3 backdrop-blur sm:-mx-4 sm:-mt-4 sm:px-4">
            <p className="text-sm font-semibold">Tool panel</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{selectedDescription}</p>
          </div>

          <div className="mt-4 space-y-3">
            <section className="space-y-3 rounded-xl border border-border bg-surface p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Area tools
                </span>
                <Crop className="size-4 text-muted-foreground" />
              </div>
              <button className={iconButton + " w-full justify-center"} disabled={!isEditorReady} onClick={addCropArea}>
                <Crop className="size-4" />
                Select area
              </button>
              <div className="grid grid-cols-3 gap-2">
                <button
                  className={iconButton + " w-full"}
                  disabled={!selectedObject || selectedObject.get("name") !== CROP_AREA_NAME}
                  onClick={() => copySelectedPdfArea(false)}
                  aria-label="Copy selected PDF area"
                >
                  <Copy className="size-4" />
                  <span className="hidden sm:inline">Copy</span>
                </button>
                <button
                  className={iconButton + " w-full"}
                  disabled={!selectedObject || selectedObject.get("name") !== CROP_AREA_NAME}
                  onClick={() => copySelectedPdfArea(true)}
                  aria-label="Cut selected PDF area"
                >
                  <Scissors className="size-4" />
                  <span className="hidden sm:inline">Cut</span>
                </button>
                <button
                  className={iconButton + " w-full"}
                  disabled={!hasPdfAreaClipboard || !isEditorReady}
                  onClick={() => void pastePdfArea()}
                  aria-label="Paste copied PDF area"
                >
                  <ClipboardPaste className="size-4" />
                  <span className="hidden sm:inline">Paste</span>
                </button>
              </div>
              <button className={primaryActionButton + " w-full justify-center"} disabled={!isEditorReady} onClick={downloadSelectedAreaPng}>
                <Download className="size-4" />
                Download selected area
              </button>
            </section>

            <section className="space-y-4 rounded-xl border border-border bg-surface p-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Selected element
              </span>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  X
                  <input
                    className="h-9 w-full rounded-md border border-input bg-panel px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    type="number"
                    min="0"
                    value={Math.round(selectedObject?.left ?? 0)}
                    disabled={!selectedObject}
                    onChange={(event) => setSelectedPosition("left", Number(event.target.value))}
                  />
                </label>
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Y
                  <input
                    className="h-9 w-full rounded-md border border-input bg-panel px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    type="number"
                    min="0"
                    value={Math.round(selectedObject?.top ?? 0)}
                    disabled={!selectedObject}
                    onChange={(event) => setSelectedPosition("top", Number(event.target.value))}
                  />
                </label>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Fill color
                  </span>
                  <input
                    className="h-9 w-12 rounded-lg border border-border bg-panel p-1"
                    type="color"
                    value={rectFillColor.startsWith("#") ? rectFillColor : "#2563eb"}
                    onChange={(event) => setRectFillColor(event.target.value)}
                  />
                </div>
                <div className="grid grid-cols-6 gap-2">
                  {MAIN_RECT_COLORS.map((color) => (
                    <button
                      key={color}
                      className={`h-8 rounded-lg border ${rectFillColor === color ? "border-primary ring-2 ring-ring" : "border-border"}`}
                      style={{ backgroundColor: color }}
                      onClick={() => {
                        setRectFillColor(color);
                        setSelectedColor(color);
                      }}
                      aria-label={`Choose color ${color}`}
                    />
                  ))}
                </div>
              </div>

              <button
                className={iconButton + " w-full justify-center"}
                type="button"
                disabled={!selectedObject || selectedObject.get("name") === CROP_AREA_NAME || pageCount <= 1}
                onClick={applySelectedObjectToAllPages}
              >
                Apply selected element to all pages
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-destructive px-3 text-sm font-semibold text-destructive-foreground shadow-soft transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-45"
                  disabled={!selectedObject}
                  onClick={deleteSelected}
                >
                  <Trash2 className="size-4" /> Delete
                </button>
                <button className={iconButton + " w-full justify-center"} onClick={clearObjects}>
                  Clear page
                </button>
              </div>
            </section>

            {tool === "eraser" && (
              <section className="space-y-3 rounded-xl border border-border bg-surface p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Eraser
                </span>
                <label className="block space-y-2 text-xs font-medium text-muted-foreground">
                  Size: {eraserSize}px
                  <input
                    className="w-full accent-primary"
                    type="range"
                    min="4"
                    max="80"
                    value={eraserSize}
                    onChange={(event) => setEraserSize(Number(event.target.value))}
                  />
                </label>
              </section>
            )}

            <details className="rounded-xl border border-border bg-surface p-3" open>
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Text options
              </summary>
              <div className="mt-3 space-y-3">
                <label className="block space-y-1 text-xs font-medium text-muted-foreground">
                  <span className="flex items-center justify-between gap-2">
                    System font
                    <button className="text-xs font-semibold text-primary" type="button" onClick={loadSystemFonts}>
                      Load all
                    </button>
                  </span>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-panel px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    disabled={!selectedText}
                    value={selectedText?.fontFamily ? String(selectedText.fontFamily).split(",")[0] : "Arial"}
                    onChange={(event) => setSelectedFontFamily(event.target.value)}
                  >
                    {availableFonts.map((font) => (
                      <option key={font} value={font} style={{ fontFamily: font }}>
                        {font}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex gap-2">
                  <input
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-panel px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    disabled={!selectedText}
                    placeholder="Type installed font name"
                    value={manualFontFamily}
                    onChange={(event) => setManualFontFamily(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && manualFontFamily.trim()) setSelectedFontFamily(manualFontFamily.trim());
                    }}
                  />
                  <button
                    className={iconButton + " h-9 px-3"}
                    disabled={!selectedText || !manualFontFamily.trim()}
                    type="button"
                    onClick={() => setSelectedFontFamily(manualFontFamily.trim())}
                  >
                    Use
                  </button>
                </div>
                <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                  <label className="space-y-1 text-xs font-medium text-muted-foreground">
                    Size
                    <input
                      className="h-9 w-full rounded-md border border-input bg-panel px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                      type="number"
                      min="6"
                      max="160"
                      disabled={!selectedText}
                      value={Math.round(Number(selectedText?.fontSize ?? 28))}
                      onChange={(event) => setSelectedFontSize(Number(event.target.value) || 28)}
                    />
                  </label>
                  <button
                    className={`${iconButton} mt-5 h-9 px-3 ${selectedText?.fontWeight === "bold" ? activeButton : ""}`}
                    disabled={!selectedText}
                    onClick={() => toggleSelectedTextStyle("bold")}
                    aria-label="Toggle bold"
                  >
                    <Bold className="size-4" />
                  </button>
                  <button
                    className={`${iconButton} mt-5 h-9 px-3 ${selectedText?.underline ? activeButton : ""}`}
                    disabled={!selectedText}
                    onClick={() => toggleSelectedTextStyle("underline")}
                    aria-label="Toggle underline"
                  >
                    <Underline className="size-4" />
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[12, 20, 28, 48].map((size) => (
                    <button key={size} className={iconButton + " h-9 px-2"} disabled={!selectedText} onClick={() => setSelectedFontSize(size)}>
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            </details>

            <details className="rounded-xl border border-border bg-surface p-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                PDF metadata
              </summary>
              <div className="mt-3 space-y-3">
                <button className={iconButton + " w-full justify-center"} type="button" onClick={clearPdfMetadata} disabled={!pdfDoc}>
                  Clear all metadata
                </button>
                {Object.entries(pdfMetadata).map(([field, value]) => (
                  <label key={field} className="block space-y-1 text-xs font-medium capitalize text-muted-foreground">
                    {field}
                    <input
                      className="h-9 w-full rounded-md border border-input bg-panel px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                      value={value}
                      disabled={!pdfDoc}
                      onChange={(event) => updatePdfMetadata(field as keyof PdfMetadata, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            </details>

            {pngPreviewUrl && (
              <section className="space-y-2 rounded-xl border border-border bg-surface p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  PNG preview
                </span>
                <img className="max-h-40 w-full rounded-lg border border-border object-contain" src={pngPreviewUrl} alt="Downloaded selected area preview" />
                <a className={iconButton + " w-full justify-center"} href={pngPreviewUrl} download={fileName.replace(/\.pdf$/i, `-page-${pageNumber}-area.png`)}>
                  Download again
                </a>
              </section>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
