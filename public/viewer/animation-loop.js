export async function runAnimationFrame(args) {
    const { driver, ready, timeout, endTimeCode, shouldDraw, drawBurstCount, drawBurstBudgetMs, frameDelayMs, applyPostDrawTransforms, applyMeshFilters, shouldApplyMeshFilters, renderFrame, } = args;
    let drawFailed = !!args.drawFailed;
    const controlsChanged = window._controls?.update?.() === true;
    const requestedFrameDelayMs = Number(frameDelayMs ?? 0);
    if (Number.isFinite(requestedFrameDelayMs) && requestedFrameDelayMs > 0 && !controlsChanged) {
        await new Promise((resolve) => setTimeout(resolve, requestedFrameDelayMs));
    }
    const secs = new Date().getTime() / 1000;
    const validTimeStep = Number.isFinite(timeout) && timeout > 0;
    const validEndTimeCode = Number.isFinite(endTimeCode) && endTimeCode > 0;
    const time = validTimeStep && validEndTimeCode ? (secs * (1000 / timeout)) % endTimeCode : 0;
    const shouldRunDraw = shouldDraw ? !!shouldDraw() : true;
    const normalizedDrawBurstCount = Number.isFinite(Number(drawBurstCount))
        ? Math.max(1, Math.min(256, Math.floor(Number(drawBurstCount))))
        : 1;
    const normalizedDrawBurstBudgetMs = Number.isFinite(Number(drawBurstBudgetMs))
        ? Math.max(0, Number(drawBurstBudgetMs))
        : 0;
    const getNow = () => ((typeof performance !== "undefined" && typeof performance.now === "function")
        ? performance.now()
        : Date.now());
    let didDraw = false;
    if (!driver?.Draw || !ready) {
        return drawFailed;
    }
    if (!drawFailed && shouldRunDraw && driver.SetTime && validTimeStep && validEndTimeCode) {
        try {
            driver.SetTime(time);
        }
        catch (timeError) {
            drawFailed = true;
            console.warn("Disabling USD animation updates after SetTime failure.", timeError);
        }
    }
    if (!drawFailed && shouldRunDraw) {
        const drawBurstStart = getNow();
        const renderInterface = window.renderInterface;
        const beginHydraDrawPhase = renderInterface?.beginHydraDrawPhase;
        const endHydraDrawPhase = renderInterface?.endHydraDrawPhase;
        const canProfilePhases = typeof beginHydraDrawPhase === "function" && typeof endHydraDrawPhase === "function";
        for (let drawIndex = 0; drawIndex < normalizedDrawBurstCount; drawIndex++) {
            if (drawIndex > 0
                && normalizedDrawBurstBudgetMs > 0
                && (getNow() - drawBurstStart) >= normalizedDrawBurstBudgetMs) {
                break;
            }
            if (canProfilePhases) {
                try {
                    beginHydraDrawPhase.call(renderInterface, "animation-loop");
                }
                catch {
                    // Keep draw resilient even when instrumentation fails.
                }
            }
            try {
                driver.Draw();
                didDraw = true;
            }
            catch (drawError) {
                drawFailed = true;
                console.warn("Disabling live USD redraw after Draw failure.", drawError);
                break;
            }
            finally {
                if (canProfilePhases) {
                    try {
                        endHydraDrawPhase.call(renderInterface);
                    }
                    catch {
                        // Keep draw resilient even when instrumentation fails.
                    }
                }
            }
        }
    }
    let postDrawTransformsChanged = false;
    if (ready && applyPostDrawTransforms) {
        try {
            postDrawTransformsChanged = applyPostDrawTransforms({
                didDraw,
                shouldRunDraw,
                drawFailed,
                controlsChanged,
            }) === true;
        }
        catch {
            postDrawTransformsChanged = false;
        }
    }
    let shouldRenderFrameNow = controlsChanged;
    if (!drawFailed && shouldRunDraw) {
        shouldRenderFrameNow = true;
    }
    if (postDrawTransformsChanged) {
        shouldRenderFrameNow = true;
    }
    const shouldApply = shouldApplyMeshFilters ? !!shouldApplyMeshFilters() : true;
    if (shouldApply) {
        applyMeshFilters();
        shouldRenderFrameNow = true;
    }
    if (shouldRenderFrameNow) {
        renderFrame();
    }
    return drawFailed;
}
