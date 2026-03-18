import { normalizeUsdPath } from "./path-utils.js";

export interface ViewerUiBindingsOptions {
  showLinkDynamics: boolean;
  showVisualMeshes: boolean;
  showCollisionMeshes: boolean;
  onToggleLinkDynamics: (enabled: boolean) => void | Promise<void>;
  onToggleVisualMeshes: (enabled: boolean) => void | Promise<void>;
  onToggleCollisionMeshes: (enabled: boolean) => void | Promise<void>;
  onExportRoundtripUsd?: () => Promise<void>;
  onUploadedFileList: (files: FileList | File[]) => Promise<void>;
  onSelectUsdFilePath: (filePath: string) => Promise<void>;
  onFilePickerStateChange?: (isOpen: boolean) => void;
}

export function bindViewerUi(options: ViewerUiBindingsOptions): () => void {
  const {
    showLinkDynamics,
    showVisualMeshes,
    showCollisionMeshes,
    onToggleLinkDynamics,
    onToggleVisualMeshes,
    onToggleCollisionMeshes,
    onExportRoundtripUsd,
    onUploadedFileList,
    onSelectUsdFilePath,
    onFilePickerStateChange,
  } = options;
  const cleanupHandlers: Array<() => void> = [];
  const bind = (
    target: EventTarget | null | undefined,
    eventName: string,
    handler: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void => {
    if (!target) return;
    target.addEventListener(eventName, handler, options);
    cleanupHandlers.push(() => {
      target.removeEventListener(eventName, handler, options);
    });
  };

  const toggleLinkDynamics = document.getElementById("toggle-link-dynamics") as HTMLInputElement | null;
  if (toggleLinkDynamics) {
    toggleLinkDynamics.checked = showLinkDynamics;
    const handleChange = () => {
      void onToggleLinkDynamics(toggleLinkDynamics.checked);
    };
    bind(toggleLinkDynamics, "change", handleChange);
  }

  const toggleVisuals = document.getElementById("toggle-visuals") as HTMLInputElement | null;
  if (toggleVisuals) {
    toggleVisuals.checked = showVisualMeshes;
    const handleChange = () => {
      void onToggleVisualMeshes(toggleVisuals.checked);
    };
    bind(toggleVisuals, "change", handleChange);
  }

  const toggleCollisions = document.getElementById("toggle-collisions") as HTMLInputElement | null;
  if (toggleCollisions) {
    toggleCollisions.checked = showCollisionMeshes;
    const handleChange = () => {
      void onToggleCollisionMeshes(toggleCollisions.checked);
    };
    bind(toggleCollisions, "change", handleChange);
  }

  const exportRoundtripButton = document.getElementById("export-roundtrip-usd") as HTMLButtonElement | null;
  if (exportRoundtripButton && onExportRoundtripUsd) {
    const handleClick = async () => {
      if (exportRoundtripButton.disabled) return;
      exportRoundtripButton.disabled = true;
      try {
        await onExportRoundtripUsd();
      } finally {
        exportRoundtripButton.disabled = false;
      }
    };
    bind(exportRoundtripButton, "click", handleClick);
  }

  const fileInput = document.getElementById("file-input") as HTMLInputElement | null;
  if (fileInput) {
    let pickerOpen = false;
    const openPicker = () => {
      if (pickerOpen) return;
      pickerOpen = true;
      onFilePickerStateChange?.(true);
    };
    const closePicker = () => {
      if (!pickerOpen) return;
      pickerOpen = false;
      onFilePickerStateChange?.(false);
    };

    const handleBlur = () => setTimeout(closePicker, 0);
    const handleWindowFocus = () => setTimeout(closePicker, 0);
    const handleChange = async () => {
      try {
        if (!fileInput.files?.length) return;
        await onUploadedFileList(fileInput.files);
      } finally {
        fileInput.value = "";
        setTimeout(closePicker, 0);
      }
    };
    bind(fileInput, "click", openPicker);
    bind(fileInput, "cancel", closePicker);
    bind(fileInput, "blur", handleBlur);
    bind(window, "focus", handleWindowFocus);
    bind(fileInput, "change", handleChange);
  }

  const folderInput = document.getElementById("folder-input") as HTMLInputElement | null;
  if (folderInput) {
    let pickerOpen = false;
    const openPicker = () => {
      if (pickerOpen) return;
      pickerOpen = true;
      onFilePickerStateChange?.(true);
    };
    const closePicker = () => {
      if (!pickerOpen) return;
      pickerOpen = false;
      onFilePickerStateChange?.(false);
    };

    const handleBlur = () => setTimeout(closePicker, 0);
    const handleWindowFocus = () => setTimeout(closePicker, 0);
    const handleChange = async () => {
      try {
        if (!folderInput.files?.length) return;
        await onUploadedFileList(folderInput.files);
      } finally {
        folderInput.value = "";
        setTimeout(closePicker, 0);
      }
    };
    bind(folderInput, "click", openPicker);
    bind(folderInput, "cancel", closePicker);
    bind(folderInput, "blur", handleBlur);
    bind(window, "focus", handleWindowFocus);
    bind(folderInput, "change", handleChange);
  }

  for (const link of document.querySelectorAll("a.file")) {
    const handleClick = async (event: Event) => {
      event.preventDefault();
      const href = (event.currentTarget as HTMLAnchorElement).href;
      if (!href) return;
      const params = new URL(href).searchParams;
      const requestedFile = normalizeUsdPath(params.get("file") || "");
      if (!requestedFile) return;
      await onSelectUsdFilePath(requestedFile);
    };
    bind(link, "click", handleClick);
  }

  return () => {
    while (cleanupHandlers.length > 0) {
      const cleanup = cleanupHandlers.pop();
      try {
        cleanup?.();
      } catch {}
    }
  };
}
