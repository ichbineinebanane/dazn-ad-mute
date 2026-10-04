// Runs in the page's JS context (MAIN world).
// DAZN inserts regional ads via Google DAI (server-side ad insertion). The DASH
// manifest from dai.google.com then contains extra <Period id="dai_pod-...">
// elements with exact start/duration in presentation time, which is the same
// time base as <video>.currentTime. We read every manifest the player loads,
// remember those ad windows and report whether playback is currently inside one.
(function () {
  "use strict";

  const TAG = "[DAZN-AdMute]";
  const AD_PERIOD_RE = /^dai_pod-/;
  const MUTE_LEAD = 0.25; // seconds to mute before the ad period starts
  const UNMUTE_LAG = 0.25; // seconds to stay muted after the ad period ends
  const KEEP_SECONDS = 15 * 60; // forget ad windows older than this
  const MAX_OPEN_AD = 120; // safety cap for an ad period whose end we never learned

  // "PT497377H38M44.127833088S" -> seconds
  function parseIsoDuration(s) {
    if (!s) return null;
    const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s.trim());
    if (!m) return null;
    const [, d, h, min, sec] = m.map((v) => (v === undefined ? 0 : parseFloat(v)));
    return d * 86400 + h * 3600 + min * 60 + sec;
  }

  // Returns [{id, start, end}] for every ad period in the manifest.
  // A period without duration (still growing, last in the list) ends where the
  // next period starts, or is open-ended (Infinity) if it is the last one.
  function parseAdPeriods(mpdText) {
    return parsePeriods(mpdText).ads;
  }

  function parsePeriods(mpdText) {
    const periods = [];
    const tagRe = /<Period\b([^>]*)>/g;
    let m;
    while ((m = tagRe.exec(mpdText))) {
      const attrs = {};
      m[1].replace(/(\w+)="([^"]*)"/g, (_, k, v) => (attrs[k] = v));
      periods.push({
        id: attrs.id || "",
        start: parseIsoDuration(attrs.start),
        duration: parseIsoDuration(attrs.duration),
      });
    }
    const ads = [];
    periods.forEach((p, i) => {
      if (!AD_PERIOD_RE.test(p.id) || p.start == null) return;
      let end;
      if (p.duration != null) end = p.start + p.duration;
      else if (periods[i + 1] && periods[i + 1].start != null) end = periods[i + 1].start;
      else end = Infinity;
      ads.push({ id: p.id, start: p.start, end });
    });
    return { periods, ads };
  }

  function isInAd(windows, t) {
    for (const w of windows) {
      const end = Math.min(w.end, w.start + MAX_OPEN_AD);
      if (t >= w.start - MUTE_LEAD && t < end + UNMUTE_LAG) return w;
    }
    return null;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseIsoDuration, parseAdPeriods, parsePeriods, isInAd };
  }
  if (typeof window === "undefined") return;

  // ---- browser part -------------------------------------------------------

  const adWindows = new Map(); // id -> {id, start, end}
  let lastManifestAt = 0;
  let lastManifestUrl = null;

  function isManifestUrl(url) {
    return typeof url === "string" && /\.mpd(\?|$)/.test(url);
  }

  function ingestManifest(text) {
    if (typeof text !== "string" || !text.includes("<MPD")) return;
    lastManifestAt = Date.now();
    const { periods, ads } = parsePeriods(text);
    for (const w of ads) {
      const prev = adWindows.get(w.id);
      if (!prev) console.log(TAG, "Werbeblock erkannt:", w.id, w.start.toFixed(3), "->", w.end);
      // Keep the most precise information: a finite end beats Infinity.
      if (!prev || w.end !== Infinity || prev.end === Infinity) adWindows.set(w.id, w);
    }
    // An open-ended ad period that already dropped out of the manifest ends
    // where the next listed period begins.
    for (const w of adWindows.values()) {
      if (w.end !== Infinity || ads.some((a) => a.id === w.id)) continue;
      const next = periods.map((p) => p.start).filter((s) => s != null && s > w.start);
      if (next.length) w.end = Math.min(...next);
    }
  }

  // Hook fetch
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input && input.url;
      const p = origFetch.apply(this, arguments);
      if (isManifestUrl(url)) {
        lastManifestUrl = url;
        p.then((res) => res.clone().text().then(ingestManifest)).catch(() => {});
      }
      return p;
    };
  }

  // Hook XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (isManifestUrl(String(url))) {
      lastManifestUrl = String(url);
      this.addEventListener("load", function () {
        try {
          if (this.responseType === "" || this.responseType === "text") ingestManifest(this.responseText);
          else if (this.responseType === "arraybuffer") ingestManifest(new TextDecoder().decode(this.response));
          else if (this.responseType === "document" && this.responseXML)
            ingestManifest(new XMLSerializer().serializeToString(this.responseXML));
        } catch (e) {
          console.warn(TAG, "Konnte Manifest nicht lesen", e);
        }
      });
    }
    return origOpen.apply(this, arguments);
  };

  // Fallback: if the player loads the manifest somewhere our hooks can't see
  // (e.g. inside a Web Worker), learn the URL from resource timing and fetch it
  // ourselves at the same 2 s interval the manifest asks for.
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (isManifestUrl(e.name)) lastManifestUrl = e.name;
    }).observe({ type: "resource", buffered: true });
  } catch (e) {}
  setInterval(() => {
    if (lastManifestUrl && Date.now() - lastManifestAt > 5000) {
      origFetch(lastManifestUrl, { credentials: "include" })
        .then((r) => r.text())
        .then(ingestManifest)
        .catch(() => {});
    }
  }, 2000);

  function pickVideo() {
    const vids = Array.from(document.querySelectorAll("video"));
    return vids.find((v) => !v.paused && v.readyState > 0) || vids.find((v) => v.readyState > 0) || null;
  }

  let inAd = false;
  let warnedTimebase = false;

  setInterval(() => {
    const v = pickVideo();
    if (!v) return;
    const t = v.currentTime;

    for (const [id, w] of adWindows) if (w.end !== Infinity && w.end < t - KEEP_SECONDS) adWindows.delete(id);

    if (!warnedTimebase && adWindows.size) {
      const any = adWindows.values().next().value;
      if (Math.abs(any.start - t) > 6 * 3600) {
        warnedTimebase = true;
        console.warn(TAG, "video.currentTime passt nicht zur Manifest-Zeitbasis", t, any.start);
      }
    }

    const w = isInAd(adWindows.values(), t);
    const now = !!w;
    if (now !== inAd) {
      inAd = now;
      console.log(TAG, now ? "Werbung startet -> mute (" + w.id + ")" : "Werbung vorbei -> unmute", "t=" + t.toFixed(2));
      window.postMessage({ source: "dazn-ad-mute", inAd: now, id: w ? w.id : null }, "*");
    }
  }, 200);

  console.log(TAG, "aktiv");
})();
