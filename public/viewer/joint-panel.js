function getJointDisplayName(linkPath) {
    const linkName = linkPath.split("/").pop() || linkPath;
    return linkName.replace(/_link$/i, "");
}
function formatAngle(value) {
    return `${value.toFixed(1)}°`;
}
export class JointPanelController {
    constructor(options) {
        this.sliderInputCleanupHandlers = [];
        this.dragging = false;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
        this.dragInitialized = false;
        this.visible = false;
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
        this.requestJointInfos = options.requestJointInfos;
        this.setJointAngle = options.setJointAngle;
        this.onJointChanged = options.onJointChanged || null;
    }
    initialize() {
        if (!this.panel || !this.header)
            return;
        this.setVisible(false);
        this.header.addEventListener("pointerdown", this.handlePointerDown);
        window.addEventListener("pointermove", this.handlePointerMove);
        window.addEventListener("pointerup", this.handlePointerUp);
        window.addEventListener("pointercancel", this.handlePointerUp);
    }
    clear() {
        this.setVisible(false);
        this.clearSliderInputHandlers();
        this.renderStatus("No joint data loaded.");
    }
    async refresh() {
        if (!this.list)
            return;
        this.renderStatus("Loading joints...");
        let joints = [];
        try {
            joints = await this.requestJointInfos();
        }
        catch (error) {
            console.warn("Failed to refresh joint panel.", error);
            this.setVisible(true);
            this.renderStatus("Failed to load joint list.");
            return;
        }
        if (!Array.isArray(joints) || joints.length === 0) {
            this.setVisible(true);
            this.renderStatus("No controllable revolute joints found.");
            return;
        }
        this.setVisible(true);
        this.renderJointRows(joints);
    }
    setVisible(visible) {
        this.visible = !!visible;
        if (this.panel) {
            this.panel.style.display = this.visible ? "block" : "none";
        }
    }
    renderStatus(message) {
        if (!this.list)
            return;
        this.clearSliderInputHandlers();
        this.list.innerHTML = "";
        const status = document.createElement("div");
        status.className = "joint-panel-status";
        status.textContent = message;
        this.list.appendChild(status);
    }
    renderJointRows(joints) {
        if (!this.list)
            return;
        this.clearSliderInputHandlers();
        this.list.innerHTML = "";
        for (const joint of joints) {
            let rowJoint = {
                ...joint,
            };
            const row = document.createElement("div");
            row.className = "joint-row";
            const title = document.createElement("div");
            title.className = "joint-row-title";
            title.textContent = `${getJointDisplayName(joint.linkPath)} [${joint.axisToken}]`;
            title.title = `${joint.linkPath}\n${joint.jointPath}`;
            const value = document.createElement("div");
            value.className = "joint-row-value";
            value.textContent = formatAngle(joint.angleDeg);
            const slider = document.createElement("input");
            slider.className = "joint-row-slider";
            slider.type = "range";
            slider.min = String(joint.lowerLimitDeg);
            slider.max = String(joint.upperLimitDeg);
            slider.step = "0.1";
            slider.value = String(rowJoint.angleDeg);
            slider.title = `${joint.lowerLimitDeg.toFixed(1)}° ~ ${joint.upperLimitDeg.toFixed(1)}°`;
            let pendingApplyFrameHandle = null;
            let hasQueuedAngle = false;
            let queuedAngleDeg = rowJoint.angleDeg;
            const flushQueuedAngle = () => {
                if (!hasQueuedAngle)
                    return;
                hasQueuedAngle = false;
                const updated = this.setJointAngle(rowJoint.linkPath, queuedAngleDeg);
                const nextInfo = updated || {
                    ...rowJoint,
                    angleDeg: queuedAngleDeg,
                };
                rowJoint = nextInfo;
                slider.value = String(nextInfo.angleDeg);
                value.textContent = formatAngle(nextInfo.angleDeg);
                if (updated && this.onJointChanged) {
                    this.onJointChanged(updated);
                }
            };
            const cancelPendingApplyFrame = () => {
                if (pendingApplyFrameHandle === null)
                    return;
                window.cancelAnimationFrame(pendingApplyFrameHandle);
                pendingApplyFrameHandle = null;
            };
            const scheduleQueuedAngleApply = () => {
                if (pendingApplyFrameHandle !== null)
                    return;
                pendingApplyFrameHandle = window.requestAnimationFrame(() => {
                    pendingApplyFrameHandle = null;
                    flushQueuedAngle();
                });
            };
            this.sliderInputCleanupHandlers.push(cancelPendingApplyFrame);
            slider.addEventListener("input", () => {
                const targetAngle = Number(slider.value);
                if (!Number.isFinite(targetAngle))
                    return;
                queuedAngleDeg = targetAngle;
                hasQueuedAngle = true;
                value.textContent = formatAngle(targetAngle);
                scheduleQueuedAngleApply();
            });
            slider.addEventListener("change", () => {
                cancelPendingApplyFrame();
                flushQueuedAngle();
            });
            row.appendChild(title);
            row.appendChild(value);
            row.appendChild(slider);
            this.list.appendChild(row);
        }
    }
    clearSliderInputHandlers() {
        if (this.sliderInputCleanupHandlers.length <= 0)
            return;
        for (const cleanup of this.sliderInputCleanupHandlers) {
            try {
                cleanup();
            }
            catch { }
        }
        this.sliderInputCleanupHandlers.length = 0;
    }
}
