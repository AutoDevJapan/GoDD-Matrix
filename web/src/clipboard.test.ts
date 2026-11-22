import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { type ClipboardEnvironment, copyToClipboard } from "./clipboard.js";

const PROMPT = "# DESIGN\n\n業種: 主として管理事務を行う本社等\n";
const SELECTION_LIFECYCLE = ["append", "select", "exec copy", "remove"];

/** How the asynchronous Clipboard API behaves in a scenario. */
type WriteMode = "resolves" | "rejects" | "throws" | "unusable" | "absent";
/** What `document.execCommand("copy")` does in a scenario. */
type CopyCommand = "copies" | "refuses" | "throws";
/** A page operation that fails while the selection-based copy is under way. */
type PageFault = "append" | "select";
/** What a page listener does to the textarea while the `copy` event is dispatched. */
type CopyListener = "moves" | "detaches";

/**
 * The part of a DOM node that the helper can reach: where it is attached, its children and its
 * removal.
 */
interface FakeNode {
  readonly name: string;
  container: FakeNode | null;
  readonly parentNode: FakeNode | null;
  readonly children: FakeNode[];
  appendChild(child: FakeNode): FakeNode;
  removeChild(child: FakeNode): FakeNode;
  remove(): void;
}

interface FakeTextarea extends FakeNode {
  value: string;
  selected: boolean;
  readonly style: { position: string; top: string };
  readonly attributes: Map<string, string>;
  setAttribute(name: string, value: string): void;
  select(): void;
}

interface Scenario {
  readonly write: WriteMode;
  readonly command?: CopyCommand;
  readonly fault?: PageFault;
  readonly duringCopy?: CopyListener;
}

/** The writer is bound to its owner like the browser one: an unbound call throws. */
function clipboardWith(written: string[], behavior: "resolves" | "rejects" | "throws") {
  return {
    sink: written,
    writeText(text: string): Promise<void> {
      this.sink.push(text);
      if (behavior === "throws") throw new Error("the write cannot start");
      return behavior === "rejects"
        ? Promise.reject(new Error("permission denied"))
        : Promise.resolve();
    },
  };
}

function names(container: FakeNode): string[] {
  return container.children.map((child) => child.name);
}

/**
 * A page whose clipboard, node tree and `copy` event can all be observed. The tree follows the
 * DOM rules the helper depends on: appending moves a node away from where it was, `removeChild`
 * throws when the node is not a child of its receiver, and `remove()` does nothing for a node that
 * is not attached.
 */
function fakePage({ write, command = "copies", fault, duringCopy }: Scenario) {
  const events: string[] = [];
  const written: string[] = [];
  const created: FakeTextarea[] = [];
  const removed: FakeNode[] = [];
  const atCopy: Array<{ value?: string; selected?: boolean; attached: boolean }> = [];

  const detach = (child: FakeNode): void => {
    const from = child.container;
    if (from === null) return;
    from.children.splice(from.children.indexOf(child), 1);
    child.container = null;
  };
  const takeOut = (child: FakeNode): void => {
    detach(child);
    events.push(child.name === "textarea" ? "remove" : `remove ${child.name}`);
    removed.push(child);
  };
  const node = (name: string): FakeNode => {
    const self: FakeNode = {
      name,
      container: null,
      get parentNode() {
        return self.container;
      },
      children: [],
      appendChild(child) {
        detach(child);
        self.children.push(child);
        child.container = self;
        return child;
      },
      removeChild(child) {
        if (child.container !== self) throw new Error("NotFoundError");
        takeOut(child);
        return child;
      },
      remove() {
        if (self.container !== null) takeOut(self);
      },
    };
    return self;
  };

  const root = node("root");
  const body = node("body");
  body.appendChild(node("bystander"));
  const elsewhere = node("elsewhere");
  elsewhere.appendChild(node("elsewhere-node"));
  root.appendChild(body);
  root.appendChild(elsewhere);
  const appendToBody = body.appendChild;
  body.appendChild = (child) => {
    events.push("append");
    if (fault === "append") throw new Error("the page refused the node");
    return appendToBody(child);
  };

  const navigators = {
    resolves: { clipboard: clipboardWith(written, "resolves") },
    rejects: { clipboard: clipboardWith(written, "rejects") },
    throws: { clipboard: clipboardWith(written, "throws") },
    unusable: { clipboard: {} },
    absent: {},
  };

  const pageDocument = {
    body,
    createElement(tag: string): FakeTextarea {
      if (tag !== "textarea") throw new Error(`unexpected element ${tag}`);
      const area: FakeTextarea = Object.assign(node("textarea"), {
        value: "",
        selected: false,
        style: { position: "", top: "" },
        attributes: new Map<string, string>(),
        setAttribute(name: string, value: string) {
          area.attributes.set(name, value);
        },
        select() {
          events.push("select");
          if (fault === "select") throw new Error("the selection was refused");
          area.selected = true;
        },
      });
      created.push(area);
      return area;
    },
    execCommand(name: string): boolean {
      events.push(`exec ${name}`);
      const target = created[0];
      atCopy.push({
        value: target?.value,
        selected: target?.selected,
        attached: target !== undefined && target.container === body,
      });
      if (target !== undefined && duringCopy === "moves") {
        events.push("page moves it");
        elsewhere.appendChild(target);
      }
      if (target !== undefined && duringCopy === "detaches") {
        events.push("page detaches it");
        detach(target);
      }
      if (command === "throws") throw new Error("the copy command failed");
      return command === "copies";
    },
  };

  const environment = {
    navigator: navigators[write],
    document: pageDocument,
  } as unknown as ClipboardEnvironment;
  return { environment, events, written, created, removed, atCopy, root, body, elsewhere };
}

describe("copyToClipboard", () => {
  it("copies through the standard API and never builds a textarea", async () => {
    const page = fakePage({ write: "resolves" });

    await expect(copyToClipboard(PROMPT, page.environment)).resolves.toBe(true);

    expect(page.written).toEqual([PROMPT]);
    expect(page.created).toHaveLength(0);
    expect(page.events).toEqual([]);
    expect(names(page.body)).toEqual(["bystander"]);
  });

  const unavailableWrites = [
    ["absent", "the Clipboard API is missing", false],
    ["unusable", "the Clipboard API has no writeText", false],
    ["rejects", "the write is rejected", true],
    ["throws", "the write throws before it starts", true],
  ] as const;
  const copyCommands = [
    ["copies", true, "the copy command succeeds"],
    ["refuses", false, "the copy command returns false"],
    ["throws", false, "the copy command throws"],
  ] as const;

  for (const [write, writeCase, attempted] of unavailableWrites) {
    for (const [command, copied, commandCase] of copyCommands) {
      it(`reports ${copied ? "success" : "failure"} when ${writeCase} and ${commandCase}`, async () => {
        const page = fakePage({ write, command });

        await expect(copyToClipboard(PROMPT, page.environment)).resolves.toBe(copied);

        expect(page.written).toEqual(attempted ? [PROMPT] : []);
        expect(page.events).toEqual(SELECTION_LIFECYCLE);
        expect(page.created).toHaveLength(1);
        const [area] = page.created;
        expect(area?.value).toBe(PROMPT);
        expect(area?.attributes.get("readonly")).toBe("");
        expect(area?.style).toEqual({ position: "fixed", top: "-1000px" });
        expect(page.atCopy).toEqual([{ value: PROMPT, selected: true, attached: true }]);
        expect(page.removed).toHaveLength(1);
        expect(page.removed[0]).toBe(area);
        expect(names(page.body)).toEqual(["bystander"]);
      });
    }
  }

  it("leaves the page untouched when the textarea cannot be appended", async () => {
    const page = fakePage({ write: "absent", fault: "append" });

    await expect(copyToClipboard(PROMPT, page.environment)).resolves.toBe(false);

    expect(page.events).toEqual(["append"]);
    expect(page.removed).toHaveLength(0);
    expect(names(page.body)).toEqual(["bystander"]);
  });

  it("takes the textarea out again when selecting it fails", async () => {
    const page = fakePage({ write: "absent", fault: "select" });

    await expect(copyToClipboard(PROMPT, page.environment)).resolves.toBe(false);

    expect(page.events).toEqual(["append", "select", "remove"]);
    expect(names(page.body)).toEqual(["bystander"]);
  });

  const outcomes = [
    ["copies", true, "succeeds"],
    ["refuses", false, "returns false"],
  ] as const;

  for (const [command, copied, outcome] of outcomes) {
    it(`removes only its own textarea after a copy listener moved it elsewhere and the copy command ${outcome}`, async () => {
      const page = fakePage({ write: "absent", command, duringCopy: "moves" });

      await expect(copyToClipboard(PROMPT, page.environment)).resolves.toBe(copied);

      expect(page.events).toEqual(["append", "select", "exec copy", "page moves it", "remove"]);
      const [area] = page.created;
      expect(area?.container).toBeNull();
      expect(page.removed).toHaveLength(1);
      expect(page.removed[0]).toBe(area);
      expect(names(page.body)).toEqual(["bystander"]);
      expect(names(page.elsewhere)).toEqual(["elsewhere-node"]);
      expect(names(page.root)).toEqual(["body", "elsewhere"]);
    });

    it(`has nothing left to remove after a copy listener detached the textarea and the copy command ${outcome}`, async () => {
      const page = fakePage({ write: "absent", command, duringCopy: "detaches" });

      await expect(copyToClipboard(PROMPT, page.environment)).resolves.toBe(copied);

      expect(page.events).toEqual(["append", "select", "exec copy", "page detaches it"]);
      const [area] = page.created;
      expect(area?.container).toBeNull();
      expect(page.removed).toHaveLength(0);
      expect(names(page.body)).toEqual(["bystander"]);
      expect(names(page.elsewhere)).toEqual(["elsewhere-node"]);
      expect(names(page.root)).toEqual(["body", "elsewhere"]);
    });
  }

  it("starts the standard write in the turn of the click", async () => {
    const page = fakePage({ write: "resolves" });

    const pending = copyToClipboard(PROMPT, page.environment);
    expect(page.written).toEqual([PROMPT]);

    await expect(pending).resolves.toBe(true);
  });

  it("runs the selection copy in the turn of the click when the API is missing", async () => {
    const page = fakePage({ write: "absent" });

    const pending = copyToClipboard(PROMPT, page.environment);
    expect(page.events).toEqual(SELECTION_LIFECYCLE);

    await expect(pending).resolves.toBe(true);
  });
});

describe("clipboard wiring in main.ts", () => {
  const SHARE_HANDLER =
    'byId("btn-share").onclick = () => copyText(window.location.href, t.toastShareCopied);';

  it("sends Copy and Share through one helper that announces the real outcome", async () => {
    const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");

    // No second route to the clipboard may bypass the checked helper.
    expect(source).not.toMatch(/navigator\.clipboard|execCommand/);

    const helper =
      /function copyText\(text: string, toastMsg: string\): void \{\n([\s\S]*?)\n\}\n/.exec(source);
    expect(helper?.[1]).toContain("copyToClipboard(text, { navigator, document })");
    expect(helper?.[1]).toContain(
      "copied ? toastMsg : TRANSLATIONS[currentLocale].toastCopyFailed",
    );

    expect(source).toContain(
      "copyButton.onclick = () => copyText(currentMarkdown(), t.toastCopied);",
    );
    // The Share button is wired twice: when the body failed to load and when it is ready.
    expect(source.split(SHARE_HANDLER)).toHaveLength(3);
  });
});
