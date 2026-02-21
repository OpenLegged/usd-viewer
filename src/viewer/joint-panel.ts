import type { JointInfoSnapshot } from "./link-rotation.js";

export interface JointPanelControllerOptions {
  panel: HTMLElement | null;
  header: HTMLElement | null;
  list: HTMLElement | null;
  requestJointInfos: () => Promise<JointInfoSnapshot[]>;
  setJointAngle: (linkPath: string, angleDeg: number) => JointInfoSnapshot | null;
  onJointChanged?: (jointInfo: JointInfoSnapshot) => void;
}

function getJointDisplayName(linkPath: string): string {
  const linkName = linkPath.split("/").pop() || linkPath;
  return linkName.replace(/_link$/i, "");
}

function formatAngle(value: number): string {
  return `${value.toFixed(1)}°`;
}

export class JointPanelController {
  private readonly panel: HTMLElement | null;
  private readonly header: HTMLElement | null;
  private readonly list: HTMLElement | null;
  private readonly requestJointInfos: () => Promise<JointInfoSnapshot[]>;
  private readonly setJointAngle: (linkPath: string, angleDeg: number) => JointInfoSnapshot | null;
  private readonly onJointChanged: ((jointInfo: JointInfoSnapshot) => void) | null;

  private dragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragInitialized = false;
  private visible = false;

  constructor(options: JointPanelControllerOptions) {
    this.panel = options.panel || null;
    this.header = options.header || null;
    this.list = options.list || null;
    this.requestJointInfos = options.requestJointInfos;
    this.setJointAngle = options.setJointAngle;
    this.onJointChanged = options.onJointChanged || null;
  }

  initialize(): void {
    if (!this.panel || !this.header) return;
    this.setVisible(false);
    this.header.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerUp);
  }

  clear(): void {
    this.setVisible(false);
    this.renderStatus("No joint data loaded.");
  }

  async refresh(): Promise<void> {
    if (!this.list) return;
    this.renderStatus("Loading joints...");

    let joints: JointInfoSnapshot[] = [];
    try {
      joints = await this.requestJointInfos();
    } catch (error) {
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

  private setVisible(visible: boolean): void {
    this.visible = !!visible;
    if (this.panel) {
      this.panel.style.display = this.visible ? "block" : "none";
    }
  }

  private renderStatus(message: string): void {
    if (!this.list) return;
    this.list.innerHTML = "";
    const status = document.createElement("div");
    status.className = "joint-panel-status";
    status.textContent = message;
    this.list.appendChild(status);
  }

  private renderJointRows(joints: JointInfoSnapshot[]): void {
    if (!this.list) return;
    this.list.innerHTML = "";

    for (const joint of joints) {
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
      slider.value = String(joint.angleDeg);
      slider.title = `${joint.lowerLimitDeg.toFixed(1)}° ~ ${joint.upperLimitDeg.toFixed(1)}°`;

      slider.addEventListener("input", () => {
        const targetAngle = Number(slider.value);
        const updated = this.setJointAngle(joint.linkPath, targetAngle);
        const nextInfo = updated || {
          ...joint,
          angleDeg: targetAngle,
        };
        value.textContent = formatAngle(nextInfo.angleDeg);
        if (updated && this.onJointChanged) {
          this.onJointChanged(updated);
        }
      });

      row.appendChild(title);
      row.appendChild(value);
      row.appendChild(slider);
      this.list.appendChild(row);
    }
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.panel || !this.header || event.button !== 0) return;
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
    } catch {}
    event.preventDefault();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.dragging || !this.panel) return;
    const nextLeft = Math.max(8, event.clientX - this.dragOffsetX);
    const nextTop = Math.max(8, event.clientY - this.dragOffsetY);
    this.panel.style.left = `${nextLeft}px`;
    this.panel.style.top = `${nextTop}px`;
  };

  private readonly handlePointerUp = (): void => {
    this.dragging = false;
  };
}
