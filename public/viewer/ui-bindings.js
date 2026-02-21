import { normalizeUsdPath } from "./path-utils.js";
export function bindViewerUi(options) {
    const { showLinkDynamics, showVisualMeshes, showCollisionMeshes, onToggleLinkDynamics, onToggleVisualMeshes, onToggleCollisionMeshes, onUploadedFileList, onSelectUsdFilePath, onFilePickerStateChange, } = options;
    const toggleLinkDynamics = document.getElementById("toggle-link-dynamics");
    if (toggleLinkDynamics) {
        toggleLinkDynamics.checked = showLinkDynamics;
        toggleLinkDynamics.addEventListener("change", () => onToggleLinkDynamics(toggleLinkDynamics.checked));
    }
    const toggleVisuals = document.getElementById("toggle-visuals");
    if (toggleVisuals) {
        toggleVisuals.checked = showVisualMeshes;
        toggleVisuals.addEventListener("change", () => onToggleVisualMeshes(toggleVisuals.checked));
    }
    const toggleCollisions = document.getElementById("toggle-collisions");
    if (toggleCollisions) {
        toggleCollisions.checked = showCollisionMeshes;
        toggleCollisions.addEventListener("change", () => onToggleCollisionMeshes(toggleCollisions.checked));
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
        fileInput.addEventListener("click", openPicker);
        fileInput.addEventListener("cancel", closePicker);
        fileInput.addEventListener("blur", () => setTimeout(closePicker, 0));
        window.addEventListener("focus", () => setTimeout(closePicker, 0));
        fileInput.addEventListener("change", async () => {
            try {
                if (!fileInput.files?.length)
                    return;
                await onUploadedFileList(fileInput.files);
            }
            finally {
                fileInput.value = "";
                setTimeout(closePicker, 0);
            }
        });
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
        folderInput.addEventListener("click", openPicker);
        folderInput.addEventListener("cancel", closePicker);
        folderInput.addEventListener("blur", () => setTimeout(closePicker, 0));
        window.addEventListener("focus", () => setTimeout(closePicker, 0));
        folderInput.addEventListener("change", async () => {
            try {
                if (!folderInput.files?.length)
                    return;
                await onUploadedFileList(folderInput.files);
            }
            finally {
                folderInput.value = "";
                setTimeout(closePicker, 0);
            }
        });
    }
    for (const link of document.querySelectorAll("a.file")) {
        link.addEventListener("click", async (event) => {
            event.preventDefault();
            const href = event.currentTarget.href;
            if (!href)
                return;
            const params = new URL(href).searchParams;
            const requestedFile = normalizeUsdPath(params.get("file") || "");
            if (!requestedFile)
                return;
            await onSelectUsdFilePath(requestedFile);
        });
    }
}
