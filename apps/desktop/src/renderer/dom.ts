/**
 * Look up an element that the page is required to contain.
 *
 * Without this, every call site needs a non-null assertion, and a renamed or
 * deleted element becomes a confusing "cannot read properties of null" halfway
 * through startup. Failing here says which selector is missing.
 */
export function mustFind<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Expected element ${selector} to exist in the page`);
  }
  return element;
}
