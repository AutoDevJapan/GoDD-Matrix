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
type PageFault = "append" | "select" | "remove";

interface FakeTextarea {
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

/** A page whose clipboard, textarea lifecycle and body children can all be observed. */
function fakePage({ write, command = "copies", fault }: Scenario) {
  const events: string[] = [];
  const written: string[] = [];
  const created: FakeTextarea[] = [];
  const removed: unknown[] = [];
  const atCopy: Array<{ value?: string; selected?: boolean; attached: boolean }> = [];
  const bystander = { id: "existing-page-node" };
  const children: unknown[] = [bystander];

  const navigators = {
    resolves: { clipboard: clipboardWith(written, "resolves") },
    rejects: { clipboard: clipboardWith(written, "rejects") },
    throws: { clipboard: clipboardWith(written, "throws") },
    unusable: { clipboard: {} },
    absent: {},
  };

  const pageDocument = {
    createElement(tag: string): FakeTextarea {
      if (tag !== "textarea") throw new Error(`unexpected element ${tag}`);
      const area: FakeTextarea = {
        value: "",
        selected: false,
        style: { position: "", top: "" },
        attributes: new Map<string, string>(),
        setAttribute(name, value) {
          area.attributes.set(name, value);
        },
        select() {
          events.push("select");
          if (fault === "select") throw new Error("the selection was refused");
          area.selected = true;
        },
      };
      created.push(area);
      return area;
    },
    body: {
      appendChild(node: unknown): unknown {
        events.push("append");
        if (fault === "append") throw new Error("the page refused the node");
        children.push(node);
        return node;
      },
      removeChild(node: unknown): unknown {
        const index = children.indexOf(node);
        if (fault === "remove" || index < 0) throw new Error("NotFoundError");
        events.push("remove");
        removed.push(node);
        children.splice(index, 1);
        return node;
      },
    },
    execCommand(name: string): boolean {
      events.push(`exec ${name}`);
      const target = created[0];
      atCopy.push({
        value: target?.value,
        selected: target?.selected,
        attached: target !== undefined && children.includes(target),
      });
      if (command === "throws") throw new Error("the copy command failed");
      return command === "copies";
    },
  };

  const environment = {
    navigator: navigators[write],
    document: pageDocument,
  } as unknown as ClipboardEnvironment;
  return { environment, events, written, created, removed, atCopy, bystander, children };
}

describe("copyToClipboard", () => {
  it("copies through the standard API and never builds a textarea", async () => {
    const page = fakePage({ write: "resolves" });

    await expect(copyToClipboard(PROMPT, page.environment)).resolves.toBe(true);

    expect(page.written).toEqual([PROMPT]);
    expect(page.created).toHaveLength(0);
    expect(page.events).toEqual([]);
    expect(page.children).toEqual([page.bystander]);
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
        expect(page.children).toEqual([page.bystander]);
      });
    }
  }

  it("leaves the page untouched when the textarea cannot be appended", async () => {
    const page = fakePage({ write: "absent", fault: "append" });

    await expect(copyToClipboard(PROMPT, page.environment)).resolves.toBe(false);

    expect(page.events).toEqual(["append"]);
    expect(page.removed).toHaveLength(0);
    expect(page.children).toEqual([page.bystander]);
  });

  it("takes the textarea out again when selecting it fails", async () => {
    const page = fakePage({ write: "absent", fault: "select" });

    await expect(copyToClipboard(PROMPT, page.environment)).resolves.toBe(false);

    expect(page.events).toEqual(["append", "select", "remove"]);
    expect(page.children).toEqual([page.bystander]);
  });

  it("keeps a confirmed copy when the page already dropped the textarea", async () => {
    const page = fakePage({ write: "absent", command: "copies", fault: "remove" });

    await expect(copyToClipboard(PROMPT, page.environment)).resolves.toBe(true);

    expect(page.events).toEqual(["append", "select", "exec copy"]);
  });

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
