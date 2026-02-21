import { createDomElement, formatCollisionPrimitiveCounts, formatJointLimits, formatMass, formatVector3, getBasename, } from "./robot-inspector/shared.js";
export { buildRobotMetadataSnapshot, } from "./robot-inspector/shared.js";
export class RobotInspectorController {
    constructor(options) {
        this.enabled = false;
        this.dragging = false;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
        this.dragInitialized = false;
        this.handlePointerDown = (event) => {
            if (!this.panel || !this.header || event.button !== 0)
                return;
            this.dragging = true;
            if (!this.dragInitialized) {
                const rect = this.panel.getBoundingClientRect();
                this.panel.style.left = `${rect.left}px`;
                this.panel.style.top = `${rect.top}px`;
                this.panel.style.right = "auto";
                this.dragInitialized = true;
            }
            const rect = this.panel.getBoundingClientRect();
            this.dragOffsetX = event.clientX - rect.left;
            this.dragOffsetY = event.clientY - rect.top;
            try {
                this.header.setPointerCapture(event.pointerId);
            }
            catch { }
            event.preventDefault();
        };
        this.handlePointerMove = (event) => {
            if (!this.dragging || !this.panel)
                return;
            const nextLeft = Math.max(8, event.clientX - this.dragOffsetX);
            const nextTop = Math.max(8, event.clientY - this.dragOffsetY);
            this.panel.style.left = `${nextLeft}px`;
            this.panel.style.top = `${nextTop}px`;
        };
        this.handlePointerUp = () => {
            this.dragging = false;
        };
        this.panel = options.panel || null;
        this.header = options.header || null;
        this.list = options.list || null;
        this.requestSnapshot = options.requestSnapshot;
    }
    initialize() {
        if (!this.panel || !this.header)
            return;
        this.header.addEventListener("pointerdown", this.handlePointerDown);
        window.addEventListener("pointermove", this.handlePointerMove);
        window.addEventListener("pointerup", this.handlePointerUp);
        window.addEventListener("pointercancel", this.handlePointerUp);
    }
    setEnabled(enabled) {
        this.enabled = !!enabled;
        if (this.panel) {
            this.panel.style.display = this.enabled ? "block" : "none";
        }
    }
    clear() {
        if (!this.enabled)
            return;
        this.renderStatus("No robot metadata loaded.");
    }
    async refresh() {
        if (!this.enabled || !this.list)
            return;
        this.renderStatus("Analyzing robot metadata...");
        let snapshot = null;
        try {
            snapshot = await this.requestSnapshot();
        }
        catch (error) {
            console.warn("Failed to refresh robot inspector.", error);
            this.renderStatus("Failed to analyze robot metadata.");
            return;
        }
        if (!snapshot) {
            this.renderStatus("No robot metadata available for this stage.");
            return;
        }
        this.renderSnapshot(snapshot);
    }
    renderStatus(message) {
        if (!this.list)
            return;
        this.list.innerHTML = "";
        this.list.appendChild(createDomElement("div", "robot-panel-status", message));
    }
    renderSnapshot(snapshot) {
        if (!this.list)
            return;
        this.list.innerHTML = "";
        const summary = document.createElement("div");
        summary.className = "robot-panel-summary";
        summary.appendChild(createDomElement("div", "robot-panel-title", snapshot.robotName));
        summary.appendChild(createDomElement("div", "robot-panel-subtitle", snapshot.stageSourcePath || "Virtual stage"));
        summary.appendChild(createDomElement("div", "robot-panel-metrics", `Links ${snapshot.totals.linkCount} · Joints ${snapshot.totals.jointCount} (ctrl ${snapshot.totals.controllableJointCount}) · Visual ${snapshot.totals.visualMeshCount} · Collision ${snapshot.totals.collisionMeshCount}`));
        summary.appendChild(createDomElement("div", "robot-panel-metrics", `Mass ${formatMass(snapshot.totals.totalMass)} · Mass links ${snapshot.totals.linksWithMass} · COM links ${snapshot.totals.linksWithCenterOfMass} · Inertia links ${snapshot.totals.linksWithInertia} · Materials ${snapshot.totals.materialCount}`));
        summary.appendChild(createDomElement("div", "robot-panel-metrics", `Collision primitives: ${formatCollisionPrimitiveCounts(snapshot.totals.collisionPrimitiveCounts)}`));
        this.list.appendChild(summary);
        this.list.appendChild(createDomElement("div", "robot-panel-section-title", "Links"));
        this.list.appendChild(this.createLinkTable(snapshot.links));
        this.list.appendChild(createDomElement("div", "robot-panel-section-title", "Joints"));
        this.list.appendChild(this.createJointTable(snapshot.joints));
    }
    createLinkTable(linkRecords) {
        const table = document.createElement("table");
        table.className = "robot-panel-table";
        const header = document.createElement("thead");
        const headerRow = document.createElement("tr");
        const headers = ["Link", "Visual/Collision", "Mass", "Center Of Mass", "Inertia", "Materials"];
        for (const column of headers) {
            headerRow.appendChild(createDomElement("th", "", column));
        }
        header.appendChild(headerRow);
        table.appendChild(header);
        const body = document.createElement("tbody");
        const maxRows = Math.min(linkRecords.length, 96);
        for (let index = 0; index < maxRows; index++) {
            const record = linkRecords[index];
            const row = document.createElement("tr");
            const linkCell = createDomElement("td", "robot-panel-cell-link", getBasename(record.linkPath) || record.linkPath);
            linkCell.title = record.linkPath;
            row.appendChild(linkCell);
            const primitiveText = formatCollisionPrimitiveCounts(record.collisionPrimitiveCounts);
            const meshCountCell = createDomElement("td", "", `${record.visualMeshCount}/${record.collisionMeshCount}${primitiveText === "-" ? "" : ` (${primitiveText})`}`);
            row.appendChild(meshCountCell);
            row.appendChild(createDomElement("td", "", formatMass(record.mass)));
            row.appendChild(createDomElement("td", "", formatVector3(record.centerOfMassLocal)));
            row.appendChild(createDomElement("td", "", formatVector3(record.diagonalInertia)));
            const materialsText = record.materialTags.length > 0 ? record.materialTags.join(", ") : "-";
            const materialsCell = createDomElement("td", "", materialsText);
            materialsCell.title = materialsText;
            row.appendChild(materialsCell);
            body.appendChild(row);
        }
        if (linkRecords.length > maxRows) {
            const overflowRow = document.createElement("tr");
            const overflowCell = createDomElement("td", "robot-panel-overflow", `Showing ${maxRows}/${linkRecords.length} links`);
            overflowCell.colSpan = headers.length;
            overflowRow.appendChild(overflowCell);
            body.appendChild(overflowRow);
        }
        table.appendChild(body);
        return table;
    }
    createJointTable(jointRecords) {
        const table = document.createElement("table");
        table.className = "robot-panel-table";
        const header = document.createElement("thead");
        const headerRow = document.createElement("tr");
        const headers = ["Joint", "Type", "Parent -> Child", "Axis", "Limits", "Control"];
        for (const column of headers) {
            headerRow.appendChild(createDomElement("th", "", column));
        }
        header.appendChild(headerRow);
        table.appendChild(header);
        const body = document.createElement("tbody");
        const maxRows = Math.min(jointRecords.length, 128);
        for (let index = 0; index < maxRows; index++) {
            const record = jointRecords[index];
            const row = document.createElement("tr");
            const jointDisplayName = getBasename(record.jointPath) || record.jointName;
            const jointCell = createDomElement("td", "robot-panel-cell-link", jointDisplayName);
            if (record.jointPath)
                jointCell.title = record.jointPath;
            row.appendChild(jointCell);
            row.appendChild(createDomElement("td", "", record.jointType));
            const parentName = record.body0Path ? (getBasename(record.body0Path) || record.body0Path) : "-";
            const childName = record.body1Path ? (getBasename(record.body1Path) || record.body1Path) : "-";
            const relationCell = createDomElement("td", "", `${parentName} -> ${childName}`);
            relationCell.title = `${record.body0Path || "-"} -> ${record.body1Path || "-"}`;
            row.appendChild(relationCell);
            row.appendChild(createDomElement("td", "", record.axisToken));
            row.appendChild(createDomElement("td", "", formatJointLimits(record.lowerLimitDeg, record.upperLimitDeg)));
            row.appendChild(createDomElement("td", "", record.controllable ? "Controllable" : "Passive"));
            body.appendChild(row);
        }
        if (jointRecords.length > maxRows) {
            const overflowRow = document.createElement("tr");
            const overflowCell = createDomElement("td", "robot-panel-overflow", `Showing ${maxRows}/${jointRecords.length} joints`);
            overflowCell.colSpan = headers.length;
            overflowRow.appendChild(overflowCell);
            body.appendChild(overflowRow);
        }
        table.appendChild(body);
        return table;
    }
}
