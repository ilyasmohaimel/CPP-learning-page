/* Runs before the app/styles: appearance only, never identity or learner data. */
(function () {
  let preference = "light";
  try {
    const base = new URL(document.currentScript.src).pathname.replace(
      /theme-init\.js$/,
      "",
    );
    const cached = localStorage.getItem("c-forge-theme:v1:" + base);
    if (cached === "light" || cached === "dark" || cached === "system")
      preference = cached;
  } catch {
    /* Blocked storage still gets the light default. */
  }
  const dark =
    preference === "dark" ||
    (preference === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#1c1d22" : "#f5f4ef");
})();
