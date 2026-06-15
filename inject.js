// inject.js — runs in the PAGE's own JS world (world: "MAIN") at document_start.
// SoundCloud plays audio through a detached `new Audio()` element that is never
// inserted into the DOM. The EQ engine in content.js lives in the isolated
// content-script world and can only hook elements that ARE in the document, so
// those detached elements are invisible to it.
//
// This patch wraps the page's own `Audio` constructor and `createElement("audio")`
// so any audio element they create gets appended (hidden) to the DOM, where
// content.js's MutationObserver can see and hook it.

(() => {
  "use strict";

  function attach(el) {
    try {
      if (!el || el.tagName !== "AUDIO") return;
      if (el.isConnected) return;
      el.style.display = "none";
      (document.body || document.documentElement).appendChild(el);
      console.log("[EQ] force-attached a detached AUDIO so it can be hooked");
    } catch (e) {}
  }

  const RealAudio = window.Audio;
  if (typeof RealAudio === "function") {
    window.Audio = new Proxy(RealAudio, {
      construct(target, args) {
        const el = Reflect.construct(target, args);
        attach(el);
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
        attach(el);
      }
      return el;
    }
  });

  console.log("[EQ] main-world injector active (catches detached new Audio())");
})();
