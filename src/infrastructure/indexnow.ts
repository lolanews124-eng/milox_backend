const SITE_URL = process.env.PUBLIC_WEB_URL ?? "https://milox.in";
const INDEXNOW_KEY = "milox-indexnow-7f3a9c2e4b1d8f60";

/** Best-effort IndexNow ping (Bing etc.). Never throws. */
export async function notifyIndexNow(pathsOrUrls: string[]): Promise<void> {
  const urlList = pathsOrUrls.map((value) =>
    value.startsWith("http") ? value : `${SITE_URL}${value.startsWith("/") ? value : `/${value}`}`,
  );
  if (urlList.length === 0) return;

  try {
    await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: new URL(SITE_URL).host,
        key: INDEXNOW_KEY,
        keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
        urlList,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Ignore network failures — indexing ping must not break admin saves.
  }
}
