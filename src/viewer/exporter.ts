import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

export function exportUsdRootAsGlb(usdRoot: any, displayFilename: string): void {
  if (!usdRoot) return;
  const exporter = new GLTFExporter();
  exporter.parse(
    usdRoot,
    (gltf) => {
      const blob = new Blob([gltf as BlobPart], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const filename = (displayFilename || "export").split("/").pop()?.split(".")[0] || "export";
      anchor.download = `${filename}.glb`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    (error) => console.error(error),
    { binary: true, animations: [] }
  );
}
