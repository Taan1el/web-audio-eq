// inject.js — runs in the PAGE's own JS world (world: "MAIN") at document_start.
// Some players (notably SoundCloud) play audio through a detached `new Audio()`
// element that is never inserted into the DOM. The EQ engine in content.js lives
// in the isolated content-script world and can only see/hook elements that are in
// the document, so those detached elements are invisible to it.
//
// This patch wraps the page's own `Audio` constructor and `createElement("audio")`
// so any audio element they create gets appended (hidden) to the DOM. Once it's in
// the document, content.js's MutationObserver sees it and hooks it like any other.

(() => {
  "use strict";

  // CRITICAL: only pull an element into the DOM once it is ACTUALLY PLAYING real
  // audio. Players like SoundCloud `new Audio()` a large pool of empty/probe
  // elements (no src, never played). Attaching all of them floods the DOM and
  // creates one MediaElementSource per element, which breaks SoundCloud's player
  // (tracks auto-skip). So we attach lazily, gated on the `playing` event + a src.
  function attach(el) {
    try {
      if (!el || el.tagName !== "AUDIO") return;
      if (el.dataset.eqAttached) return;
      if (el.isConnected) return;
      const hasMedia = el.currentSrc || el.src;
      if (!hasMedia) return;
      el.dataset.eqAttached = "1";
      el.style.display = "none";
      (document.body || document.documentElement).appendChild(el);
      console.log("[EQ] force-attached a PLAYING detached AUDIO so it can be hooked");
    } catch (e) {}
  }

  // Watch a created audio element; attach only when it begins real playback.
  function watch(el) {
    try {
      if (!el || el.tagName !== "AUDIO") return;
      el.addEventListener("playing", () => attach(el));
    } catch (e) {}
  }

  const RealAudio = window.Audio;
  if (typeof RealAudio === "function") {
    window.Audio = new Proxy(RealAudio, {
      construct(target, args) {
        const el = Reflect.construct(target, args);
        watch(el);
        return el;
      }
    });
  }

  const realCreate = Document.prototype.createElement;
  Document.prototype.createElement = new Proxy(realCreate, {
    apply(target, thisArg, args) {
      const el = Reflect.apply(target, thisArg, args);
      const name = args[0];
      if (typeof name === "string" && name.toLowerCase() === "audio") {
        watch(el);
      }
      return el;
    }
  });

  console.log("[EQ] main-world injector active (catches detached new Audio())");
})();
