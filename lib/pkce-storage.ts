const PKCE_VERIFIER_KEY = "pkce_code_verifier";
const PKCE_COOKIE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes

function isBrowser() {
  return typeof window !== "undefined";
}

function getCookie(name: string): string | null {
  if (!isBrowser()) {
    return null;
  }

  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return decodeURIComponent(trimmed.substring(name.length + 1));
    }
  }

  return null;
}

function setCookie(name: string, value: string) {
  if (!isBrowser()) {
    return;
  }

  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(
    value
  )}; Max-Age=${PKCE_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

function clearCookie(name: string) {
  if (!isBrowser()) {
    return;
  }

  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
}

export function setPkceCodeVerifier(verifier: string) {
  if (!isBrowser()) {
    return;
  }

  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  localStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  setCookie(PKCE_VERIFIER_KEY, verifier);
}

export function getPkceCodeVerifier(): {
  codeVerifier: string | null;
  source: "sessionStorage" | "localStorage" | "cookie" | "none";
} {
  if (!isBrowser()) {
    return { codeVerifier: null, source: "none" };
  }

  const sessionVerifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (sessionVerifier) {
    return { codeVerifier: sessionVerifier, source: "sessionStorage" };
  }

  const localVerifier = localStorage.getItem(PKCE_VERIFIER_KEY);
  if (localVerifier) {
    return { codeVerifier: localVerifier, source: "localStorage" };
  }

  const cookieVerifier = getCookie(PKCE_VERIFIER_KEY);
  if (cookieVerifier) {
    return { codeVerifier: cookieVerifier, source: "cookie" };
  }

  return { codeVerifier: null, source: "none" };
}

export function clearPkceCodeVerifier() {
  if (!isBrowser()) {
    return;
  }

  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  localStorage.removeItem(PKCE_VERIFIER_KEY);
  clearCookie(PKCE_VERIFIER_KEY);
}
