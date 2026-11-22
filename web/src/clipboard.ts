/**
 * Copy text to the system clipboard for the Copy and Share buttons.
 *
 * The standard asynchronous Clipboard API is used first. It is missing on insecure origins and can
 * be refused (permission, focus or user gesture), so a selection-based copy through a temporary
 * read-only textarea follows. The result reports whether either route confirmed the copy, so the
 * page announces only a copy that happened.
 */

/** The part of the asynchronous Clipboard API that is used. */
interface AsyncClipboard {
  writeText(text: string): Promise<void>;
}

/** What the helper reads from the page; `navigator.clipboard` is missing on insecure origins. */
export interface ClipboardEnvironment {
  readonly navigator: { readonly clipboard?: AsyncClipboard | undefined };
  readonly document: Document;
}

/**
 * Selection-based copy through a temporary textarea. It is true only when `execCommand("copy")`
 * reports success. The textarea this call attached is always taken out again, wherever it is by
 * then: the `copy` event is dispatched while the command runs, and a page listener may have moved
 * or removed the element.
 */
function copyBySelection(text: string, document: Document): boolean {
  let attached: HTMLTextAreaElement | undefined;
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.appendChild(area);
    attached = area;
    area.select();
    return document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    // `remove()` takes the element out of wherever it is and does nothing when it is already
    // detached, so only this textarea is touched.
    attached?.remove();
  }
}

/**
 * Copy `text` and report whether it reached the clipboard.
 *
 * The standard write starts synchronously, in the turn of the click, so the browser still sees the
 * user gesture. Without the API the selection-based copy runs in the same turn; after a refusal it
 * runs once the rejection arrives. Refusals and page-side failures come back as `false` and do not
 * reject the promise.
 */
export async function copyToClipboard(
  text: string,
  environment: ClipboardEnvironment,
): Promise<boolean> {
  try {
    const clipboard = environment.navigator.clipboard;
    if (typeof clipboard?.writeText === "function") {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused or unusable: use the selection-based copy.
  }
  return copyBySelection(text, environment.document);
}
