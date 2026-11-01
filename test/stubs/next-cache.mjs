/** Cache Components lifecycle hooks are no-ops outside the Next server. */
export function cacheLife() {}
export function cacheTag() {}
export function updateTag() {}
export function revalidateTag() {}
export function revalidatePath() {}
export function unstable_cache(fn) {
  return fn;
}
