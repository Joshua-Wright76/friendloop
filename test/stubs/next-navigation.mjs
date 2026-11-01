/** Next signals notFound()/redirect() by throwing a digest error. */
export function notFound() {
  const error = new Error("NEXT_NOT_FOUND");
  error.digest = "NEXT_HTTP_ERROR_FALLBACK;404";
  throw error;
}

export function redirect(target) {
  const error = new Error("NEXT_REDIRECT");
  error.digest = `NEXT_REDIRECT;replace;${target};307;`;
  throw error;
}

export function forbidden() {
  const error = new Error("NEXT_FORBIDDEN");
  error.digest = "NEXT_HTTP_ERROR_FALLBACK;403";
  throw error;
}
