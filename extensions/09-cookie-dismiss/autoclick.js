// No Cookies – clicks "Reject all" on known consent platforms.
// Watches the page for at most 15 seconds, then stops completely.
(() => {
  if (window.__noCookies) return;
  window.__noCookies = true;

  // [name, how to find the reject button, element that proves the banner is there]
  const CMPS = [
    ["OneTrust", ["#onetrust-reject-all-handler", ".ot-pc-refuse-all-handler"], "#onetrust-banner-sdk, #onetrust-consent-sdk"],
    ["Cookiebot", ["#CybotCookiebotDialogBodyButtonDecline", "#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll"], "#CybotCookiebotDialog"],
    ["Didomi", ["#didomi-notice-disagree-button", ".didomi-continue-without-agreeing"], "#didomi-host"],
    ["Quantcast", [".qc-cmp2-summary-buttons button[mode='secondary']", ".qc-cmp2-footer button[mode='secondary']"], ".qc-cmp2-container"],
    ["TrustArc", ["#truste-consent-required", ".truste-consent-required"], "#truste-consent-track, .truste_box_overlay"],
    ["CookieYes", [".cky-btn-reject"], ".cky-consent-container"],
    ["Complianz", [".cmplz-btn.cmplz-deny"], "#cmplz-cookiebanner-container, .cmplz-cookiebanner"],
    ["Osano", [".osano-cm-denyAll"], ".osano-cm-window"],
    ["iubenda", [".iubenda-cs-reject-btn"], "#iubenda-cs-banner"],
    ["Borlabs", ["a[data-cookie-refuse]", "#BorlabsCookieBox .brlbs-btn-accept-only-essential"], "#BorlabsCookieBox"],
    ["Klaro", [".cm-btn-decline", ".cn-decline"], ".klaro"],
    ["Termly", ["[data-tid='banner-decline']"], "#termly-code-snippet-support"],
    ["Sourcepoint", ["button.sp_choice_type_REJECT_ALL", "button.sp_choice_type_13"], "body"], // runs inside its own iframe
    ["Google", ["form[action*='consent'] button[aria-label*='Reject']", "form[action*='consent'] button"], "form[action*='consent']"],
  ];
  const isGoogleConsent = /^consent\.(google|youtube)\./.test(location.hostname);

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }

  function unlockScroll() {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      if (getComputedStyle(el).overflow === "hidden") el.style.setProperty("overflow", "auto", "important");
      el.classList.remove("ot-overflow-hidden", "didomi-popup-open", "qc-cmp-ui-showing", "cmplz-blocked");
    }
  }

  // Usercentrics hides its buttons inside a shadow root
  function usercentrics() {
    const host = document.querySelector("#usercentrics-root, #usercentrics-cmp-ui");
    const btn = host && host.shadowRoot && host.shadowRoot.querySelector("[data-testid='uc-deny-all-button']");
    if (btn) { btn.click(); return true; }
    return false;
  }

  let done = false;
  function tryReject() {
    if (done) return;
    if (usercentrics()) return finish("Usercentrics");
    for (const [name, buttons, marker] of CMPS) {
      if (name === "Google" && !isGoogleConsent) continue;
      if (name === "Sourcepoint" && window === top) continue;
      if (!document.querySelector(marker)) continue;
      for (const sel of buttons) {
        const b = document.querySelector(sel);
        if (b && visible(b)) { b.click(); return finish(name); }
      }
    }
  }

  function finish(name) {
    done = true;
    observer.disconnect();
    setTimeout(unlockScroll, 300);
    chrome.runtime.sendMessage({ type: "rejected", name }).catch(() => {});
  }

  const observer = new MutationObserver(() => {
    // run at most once per animation frame, however many changes arrive
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; tryReject(); });
  });
  let pending = false;

  tryReject();
  if (!done) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 15000);
  }
})();
