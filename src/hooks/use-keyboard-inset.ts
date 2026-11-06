import { useEffect, useRef, useState } from "react";
import { Keyboard, Platform } from "react-native";
import { isWeb } from "../constants/platform";

// Height (in px) of the on-screen keyboard as it overlaps the layout viewport.
//
// On web we read window.visualViewport: when the soft keyboard opens, the visual
// viewport shrinks while the layout viewport stays put, so the difference is the
// keyboard's occluded height. On native we listen to the Keyboard module and
// return endCoordinates.height. Either way, callers can lift a bottom-pinned
// floating dock so it rides above the keyboard instead of being covered by it.
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  const lastInsetRef = useRef(0);

  useEffect(() => {
    if (isWeb) {
      if (typeof window === "undefined") return;
      const vv = window.visualViewport;
      if (!vv) return;

      const root = document.getElementById("root");
      const originalRootTransform = root?.style.transform ?? "";
      let frame: number | null = null;
      let lastPageOffset = 0;
      let lastScrollResetOffset = -1;
      let keyboardWasOpen = false;
      let preliftUntil = 0;
      let preliftTimer: number | null = null;
      // On recent iOS versions `window.innerHeight` can shrink together with
      // the visual viewport. Capture the resting visual height before focus so
      // keyboard clearance never depends on that moving value.
      let restingViewportHeight = vv.height;
      const keyboardCacheKey = `kel-keyboard-inset:${Math.round(window.innerWidth)}`;
      let cachedKeyboardInset = 0;
      try {
        const storedInset = Number(window.sessionStorage.getItem(keyboardCacheKey));
        if (Number.isFinite(storedInset) && storedInset > 40) {
          cachedKeyboardInset = storedInset;
        }
      } catch {
        // Storage can be unavailable in private/embedded browsing contexts.
      }

      const isEditableElement = (target: EventTarget | null) =>
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      const compensatePagePan = (offsetTop: number) => {
        const nextOffset = Math.max(0, Math.round(offsetTop));
        if (root && nextOffset !== lastPageOffset) {
          root.style.transform = nextOffset > 0
            ? `${originalRootTransform ? `${originalRootTransform} ` : ""}translate3d(0, ${nextOffset}px, 0)`
            : originalRootTransform;
          lastPageOffset = nextOffset;
        }

        // iOS normally exposes its focus pan as page scroll, but some releases
        // leave it only in visualViewport.offsetTop. Reset the former and keep
        // the transform above as a visual fallback for the latter.
        if (
          nextOffset > 0 &&
          (window.scrollX !== 0 ||
            window.scrollY !== 0 ||
            Math.abs(nextOffset - lastScrollResetOffset) >= 2)
        ) {
          lastScrollResetOffset = nextOffset;
          window.scrollTo(0, 0);
        }
      };

      const measure = () => {
        frame = null;
        const editable = isEditableElement(document.activeElement);
        if (!editable && !keyboardWasOpen && vv.scale === 1) {
          // Follow address-bar and orientation changes while no keyboard is
          // active, so the next focus starts from the actual visible height.
          restingViewportHeight = vv.height;
        }
        // The keyboard shrinks the visual viewport. `offsetTop` is Safari
        // panning the page to reveal the focused field, not usable keyboard
        // clearance: subtracting it here lets the header disappear off-screen.
        const occluded = Math.max(0, restingViewportHeight - vv.height);
        const keyboardOpen = editable && vv.scale === 1 && occluded > 40;
        if (keyboardOpen) keyboardWasOpen = true;

        // Keep the app shell visually anchored to the top while only the
        // bottom composer consumes `occluded`. Retain compensation briefly if
        // Safari leaves a stale offsetTop after dismissing the keyboard.
        const shouldCompensate = vv.scale === 1 && (keyboardOpen || keyboardWasOpen);
        compensatePagePan(shouldCompensate ? vv.offsetTop : 0);
        if (!keyboardOpen && vv.offsetTop <= 1) {
          keyboardWasOpen = false;
          lastScrollResetOffset = -1;
        }

        const measuredInset = keyboardOpen
          ? Math.max(0, Math.round(occluded))
          : 0;
        const preliftActive =
          editable && cachedKeyboardInset > 40 && performance.now() < preliftUntil;
        // Keep the pre-lift target stable for one keyboard animation. Without
        // this, intermediate VisualViewport heights repeatedly replace the
        // target and make the page race ahead of the keyboard.
        const next = preliftActive ? cachedKeyboardInset : measuredInset;
        if (measuredInset > 40 && !preliftActive) {
          cachedKeyboardInset = measuredInset;
          try {
            window.sessionStorage.setItem(keyboardCacheKey, String(measuredInset));
          } catch {
            // Keep the in-memory cache when storage is unavailable.
          }
        }
        if (Math.abs(next - lastInsetRef.current) < 2) return;
        lastInsetRef.current = next;
        setInset(next);
      };
      const update = () => {
        if (frame === null) frame = window.requestAnimationFrame(measure);
      };
      const onViewportChange = () => {
        // VisualViewport events are delivered before the next paint. Counter
        // Safari's focus pan immediately here; waiting for the rAF used for the
        // React state update leaves one visibly shifted frame during keyboard
        // animation.
        const shouldCompensate =
          vv.scale === 1 && (isEditableElement(document.activeElement) || keyboardWasOpen);
        compensatePagePan(shouldCompensate ? vv.offsetTop : 0);
        update();
      };
      const onFocusIn = (event: FocusEvent) => {
        if (isEditableElement(event.target) && !keyboardWasOpen) {
          // `focusin` fires before Safari's keyboard resize animation.
          restingViewportHeight = vv.height;
        }
        compensatePagePan(vv.scale === 1 ? vv.offsetTop : 0);
        update();
      };
      const onMouseDown = (event: MouseEvent) => {
        if (typeof navigator === "undefined" || navigator.maxTouchPoints <= 0) return;
        const target = event.target;
        if (!isEditableElement(target) || document.activeElement === target) return;

        // Lift the known composer before Safari performs its pre-focus
        // visibility check. The direct style bridges the current event; React
        // takes over with the same inset immediately afterwards.
        if (cachedKeyboardInset > 40) {
          preliftUntil = performance.now() + 260;
          if (preliftTimer !== null) window.clearTimeout(preliftTimer);
          preliftTimer = window.setTimeout(() => {
            preliftTimer = null;
            preliftUntil = 0;
            update();
          }, 270);
          const composer = target instanceof Element
            ? target.closest<HTMLElement>("#kel-document-composer, #kel-agent-composer")
            : null;
          if (composer) composer.style.paddingBottom = `${cachedKeyboardInset + 4}px`;
          lastInsetRef.current = cachedKeyboardInset;
          setInset(cachedKeyboardInset);
        }

        // Programmatic focus remains inside this trusted mousedown, so iOS
        // opens the keyboard without performing its default scroll-into-view.
        (target as HTMLElement).focus({ preventScroll: true });
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          const end = target.value.length;
          target.setSelectionRange(end, end);
        }
        event.preventDefault();
      };

      update();
      vv.addEventListener("resize", onViewportChange);
      vv.addEventListener("scroll", onViewportChange);
      window.addEventListener("resize", onViewportChange);
      document.addEventListener("focusin", onFocusIn);
      document.addEventListener("mousedown", onMouseDown, true);
      return () => {
        vv.removeEventListener("resize", onViewportChange);
        vv.removeEventListener("scroll", onViewportChange);
        window.removeEventListener("resize", onViewportChange);
        document.removeEventListener("focusin", onFocusIn);
        document.removeEventListener("mousedown", onMouseDown, true);
        if (frame !== null) window.cancelAnimationFrame(frame);
        if (preliftTimer !== null) window.clearTimeout(preliftTimer);
        if (root) root.style.transform = originalRootTransform;
      };
    }

    // Native: track the keyboard height directly. iOS fires the "will" events
    // (so the dock animates up in step with the keyboard); Android only has the
    // "did" variants.
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvt, (e) => {
      const next = e.endCoordinates?.height ?? 0;
      lastInsetRef.current = next;
      setInset(next);
    });
    const hideSub = Keyboard.addListener(hideEvt, () => {
      lastInsetRef.current = 0;
      setInset(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return inset;
}
