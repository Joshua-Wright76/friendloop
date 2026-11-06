// Injected into every document while recording. Pure video furniture: a caption
// pill and a tap/click marker in a closed shadow root, never touching page layout
// or receiving pointer events.
(() => {
  if (window.__flrec) return;
  // Runs before the fake clock's script: a frozen Date would never use up a caption's hold.
  const realNow = Date.now.bind(Date);
  const state = { host: null, pill: null, tag: null, layer: null, hide: 0 };
  function ensure() {
    if (state.host && state.host.isConnected) return true;
    if (!document.documentElement) return false;
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("data-flrec", "");
    Object.assign(host.style, { position: "fixed", inset: "0", zIndex: "2147483647", pointerEvents: "none" });
    const root = host.attachShadow({ mode: "closed" });
    const mobile = innerWidth < 600;
    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      position: "fixed", left: "0", right: "0", [mobile ? "top" : "bottom"]: mobile ? "6px" : "18px",
      display: "flex", justifyContent: "center", padding: "0 8px", pointerEvents: "none",
    });
    const pill = document.createElement("div");
    Object.assign(pill.style, {
      font: `600 ${mobile ? 13 : 15}px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
      color: "#fff", background: "rgba(20,20,28,.88)", borderRadius: "10px", padding: mobile ? "6px 10px" : "8px 14px",
      maxWidth: mobile ? "94vw" : "70vw", textAlign: "center", boxShadow: "0 2px 10px rgba(0,0,0,.35)",
      transition: "opacity .35s", opacity: "0",
    });
    const tag = document.createElement("span");
    Object.assign(tag.style, { color: "#ffd166", marginRight: "8px" });
    const text = document.createElement("span");
    pill.append(tag, text);
    wrap.append(pill);
    const layer = document.createElement("div");
    root.append(wrap, layer);
    document.documentElement.append(host);
    Object.assign(state, { host, pill, tag, text, layer });
    return true;
  }
  function caption(id, message, hold) {
    if (!ensure()) return;
    sessionStorage.setItem("__flrec_caption", JSON.stringify({ id, message, hold, at: realNow() }));
    state.tag.textContent = id;
    state.text.textContent = message;
    state.pill.style.opacity = "1";
    clearTimeout(state.hide);
    // Fades so the caption never sits on top of the thing being inspected.
    if (hold > 0) state.hide = setTimeout(() => { state.pill.style.opacity = "0"; }, hold);
  }
  function mark(x, y) {
    if (!ensure()) return;
    const dot = document.createElement("div");
    Object.assign(dot.style, {
      position: "fixed", left: `${x - 22}px`, top: `${y - 22}px`, width: "44px", height: "44px", borderRadius: "50%",
      background: "rgba(255,70,90,.35)", border: "3px solid rgba(255,70,90,.95)", boxSizing: "border-box",
      transform: "scale(.5)", transition: "transform .45s ease-out, opacity .45s ease-out", opacity: "1",
    });
    state.layer.append(dot);
    requestAnimationFrame(() => { dot.style.transform = "scale(1.3)"; dot.style.opacity = "0"; });
    setTimeout(() => dot.remove(), 700);
  }
  addEventListener("pointerdown", (event) => mark(event.clientX, event.clientY), { capture: true, passive: true });
  addEventListener("touchstart", (event) => {
    const touch = event.touches[0];
    if (touch) mark(touch.clientX, touch.clientY);
  }, { capture: true, passive: true });
  window.__flrec = { caption, mark };
  // A caption survives a navigation for whatever is left of its hold.
  const restore = () => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("__flrec_caption") || "null");
      if (!saved) return;
      const left = saved.hold - (realNow() - saved.at);
      if (left > 300) caption(saved.id, saved.message, left);
    } catch {}
  };
  if (document.documentElement) restore();
  else addEventListener("DOMContentLoaded", restore);
})();
