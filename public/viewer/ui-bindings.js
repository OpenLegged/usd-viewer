import { normalizeUsdPath } from "./path-utils.js";
export function bindViewerUi(options) {
    const { showLinkDynamics, showVisualMeshes, showCollisionMeshes, onToggleLinkDynamics, onToggleVisualMeshes, onToggleCollisionMeshes, onExportRoundtripUsd, onUploadedFileList, onSelectUsdFilePath, onFilePickerStateChange, } = options;
    const cleanupHandlers = [];
    const bind = (target, eventName, handler, options) => {
        if (!target)
            return;
        target.addEventListener(eventName, handler, options);
        cleanupHandlers.push(() => {
            target.removeEventListener(eventName, handler, options);
        });
    };
    const toggleLinkDynamics = document.getElementById("toggle-link-dynamics");
    if (toggleLinkDynamics) {
        toggleLinkDynamics.checked = showLinkDynamics;
        const handleChange = () => {
            void onToggleLinkDynamics(toggleLinkDynamics.checked);
        };
        bind(toggleLinkDynamics, "change", handleChange);
    }
    const toggleVisuals = document.getElementById("toggle-visuals");
    if (toggleVisuals) {
        toggleVisuals.checked = showVisualMeshes;
        const handleChange = () => {
            void onToggleVisualMeshes(toggleVisuals.checked);
        };
        bind(toggleVisuals, "change", handleChange);
    }
    const toggleCollisions = document.getElementById("toggle-collisions");
    if (toggleCollisions) {
        toggleCollisions.checked = showCollisionMeshes;
        const handleChange = () => {
            void onToggleCollisionMeshes(toggleCollisions.checked);
        };
        bind(toggleCollisions, "change", handleChange);
    }
    const exportRoundtripButton = document.getElementById("export-roundtrip-usd");
    if (exportRoundtripButton && onExportRoundtripUsd) {
        const handleClick = async () => {
            if (exportRoundtripButton.disabled)
                return;
            exportRoundtripButton.disabled = true;
            try {
                await onExportRoundtripUsd();
            }
            finally {
                exportRoundtripButton.disabled = false;
            }
        };
        bind(exportRoundtripButton, "click", handleClick);
    }
    const fileInput = document.getElementById("file-input");
    if (fileInput) {
        let pickerOpen = false;
        const openPicker = () => {
            if (pickerOpen)
                return;
            pickerOpen = true;
            onFilePickerStateChange?.(true);
        };
        const closePicker = () => {
            if (!pickerOpen)
                return;
            pickerOpen = false;
            onFilePickerStateChange?.(false);
        };
        const handleBlur = () => setTimeout(closePicker, 0);
        const handleWindowFocus = () => setTimeout(closePicker, 0);
        const handleChange = async () => {
            try {
                if (!fileInput.files?.length)
                    return;
                await onUploadedFileList(fileInput.files);
            }
            finally {
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
    const folderInput = document.getElementById("folder-input");
    if (folderInput) {
        let pickerOpen = false;
        const openPicker = () => {
            if (pickerOpen)
                return;
            pickerOpen = true;
            onFilePickerStateChange?.(true);
        };
        const closePicker = () => {
            if (!pickerOpen)
                return;
            pickerOpen = false;
            onFilePickerStateChange?.(false);
        };
        const handleBlur = () => setTimeout(closePicker, 0);
        const handleWindowFocus = () => setTimeout(closePicker, 0);
        const handleChange = async () => {
            try {
                if (!folderInput.files?.length)
                    return;
                await onUploadedFileList(folderInput.files);
            }
            finally {
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
        const handleClick = async (event) => {
            event.preventDefault();
            const href = event.currentTarget.href;
            if (!href)
                return;
            const params = new URL(href).searchParams;
            const requestedFile = normalizeUsdPath(params.get("file") || "");
            if (!requestedFile)
                return;
            await onSelectUsdFilePath(requestedFile);
        };
        bind(link, "click", handleClick);
    }
    return () => {
        while (cleanupHandlers.length > 0) {
            const cleanup = cleanupHandlers.pop();
            try {
                cleanup?.();
            }
            catch { }
        }
    };
}
