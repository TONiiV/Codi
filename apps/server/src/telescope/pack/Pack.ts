import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Schema from "effect/Schema";

export const HARNESSES = ["claude", "codex", "cursor", "opencode"] as const;
export type HarnessName = (typeof HARNESSES)[number];

const McpServer = Schema.Struct({
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.Array(Schema.String)),
  url: Schema.optional(Schema.String),
});
export type McpServer = typeof McpServer.Type;
export type McpServers = Readonly<Record<string, McpServer>>;

const McpFile = Schema.fromJsonString(
  Schema.Struct({ servers: Schema.Record(Schema.String, McpServer) }),
  { space: 2 },
);

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    name: Schema.String,
    createdAt: Schema.String,
    source: Schema.Struct({ harness: Schema.Literals(HARNESSES), path: Schema.String }),
    instructions: Schema.String,
    skills: Schema.Array(Schema.String),
    mcp: Schema.String,
  }),
  { space: 2 },
);

const encodeManifest = Schema.encodeEffect(Manifest);
const decodeManifest = Schema.decodeEffect(Manifest);
const encodeMcpFile = Schema.encodeEffect(McpFile);
const decodeMcpFile = Schema.decodeEffect(McpFile);

export interface Pack {
  readonly instructions: string;
  readonly skills: ReadonlyArray<{ readonly name: string; readonly dir: string }>;
  readonly mcp: McpServers;
}

export class ContextPackFormatError extends Schema.TaggedError<ContextPackFormatError>()(
  "ContextPackFormatError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not parse ${this.path}.`;
  }
}

type HarnessEffect<A> = Effect.Effect<
  A,
  PlatformError | ContextPackFormatError,
  FileSystem.FileSystem | Path.Path
>;

export interface HarnessSpec {
  readonly markers: ReadonlyArray<string>;
  readonly instructions: {
    readonly read: (dir: string) => HarnessEffect<string | undefined>;
    readonly write: (dir: string, text: string, merge: boolean) => HarnessEffect<void>;
  };
  readonly skillsDir: string;
  readonly mcp: {
    readonly file: string;
    readonly read: (text: string) => McpServers;
    readonly write: (existing: string | undefined, servers: McpServers, merge: boolean) => string;
  };
}

export type Harness = ReturnType<typeof makeHarness>;

export const makeHarness = (spec: HarnessSpec) => {
  const parse = <A>(path: string, run: () => A) =>
    Effect.try({ try: run, catch: (cause) => new ContextPackFormatError({ path, cause }) });
  return {
    detect: Effect.fnUntraced(function* (dir: string) {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      for (const marker of spec.markers) if (yield* fs.exists(path.join(dir, marker))) return true;
      return false;
    }),
    read: Effect.fnUntraced(function* (dir: string) {
      const path = yield* Path.Path;
      const mcpFile = path.join(dir, spec.mcp.file);
      const mcpText = yield* readOptionalText(mcpFile);
      return {
        instructions: (yield* spec.instructions.read(dir)) ?? "",
        skills: yield* readSkills(path.join(dir, spec.skillsDir)),
        mcp: mcpText === undefined ? {} : yield* parse(mcpFile, () => spec.mcp.read(mcpText)),
      } satisfies Pack;
    }),
    write: Effect.fnUntraced(function* (pack: Pack, dir: string, merge: boolean) {
      const path = yield* Path.Path;
      yield* spec.instructions.write(dir, pack.instructions, merge);
      yield* writeSkills(pack.skills, path.join(dir, spec.skillsDir));
      const mcpFile = path.join(dir, spec.mcp.file);
      const existing = yield* readOptionalText(mcpFile);
      if (existing === undefined && Object.keys(pack.mcp).length === 0) return;
      const text = yield* parse(mcpFile, () => spec.mcp.write(existing, pack.mcp, merge));
      yield* writeText(mcpFile, text);
    }),
  };
};

export const markdownInstructions = (file: string): HarnessSpec["instructions"] => ({
  read: Effect.fnUntraced(function* (dir) {
    return yield* readOptionalText((yield* Path.Path).join(dir, file));
  }),
  write: Effect.fnUntraced(function* (dir, text, merge) {
    const target = (yield* Path.Path).join(dir, file);
    yield* writeText(target, mergeInstructions(yield* readOptionalText(target), text, merge));
  }),
});

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const objectAt = (value: unknown): Json => (isObject(value) ? value : {});
export const stringAt = (value: unknown) => (typeof value === "string" ? value : undefined);
export const stringsAt = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;
export const keysAt = (value: unknown) => (isObject(value) ? Object.keys(value) : undefined);

export const envPlaceholders = (
  names: ReadonlyArray<string> | undefined,
  render: (name: string) => string,
) => (names?.length ? Object.fromEntries(names.map((name) => [name, render(name)])) : undefined);

const mapValues = <A, B>(record: Readonly<Record<string, A>>, f: (a: A) => B) =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [key, f(value)]));

// Servers live under one key of a JSON file the harness may share with other settings.
export const jsonMcp = (
  file: string,
  key: string,
  toNative: (server: McpServer) => Json,
  fromNative: (native: Json) => McpServer = (native) => ({
    command: stringAt(native.command),
    args: stringsAt(native.args),
    env: keysAt(native.env),
    url: stringAt(native.url),
  }),
): HarnessSpec["mcp"] => ({
  file,
  read: (text) =>
    mapValues(objectAt(objectAt(JSON.parse(text))[key]), (v) => fromNative(objectAt(v))),
  write: (existing, servers, merge) => {
    const doc = existing === undefined ? {} : objectAt(JSON.parse(existing));
    const native = mapValues(servers, toNative);
    doc[key] = merge ? { ...objectAt(doc[key]), ...native } : native;
    return `${JSON.stringify(doc, null, 2)}\n`;
  },
});

export const readOptionalText = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.exists(file)) ? yield* fs.readFileString(file) : undefined;
});

export const writeText = Effect.fnUntraced(function* (file: string, text: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory((yield* Path.Path).dirname(file), { recursive: true });
  yield* fs.writeFileString(file, text);
});

const BLOCK = /<!-- context-pack:begin -->[\s\S]*?<!-- context-pack:end -->/;

// Merge keeps the harness file and swaps only the block a previous import wrote.
const mergeInstructions = (existing: string | undefined, text: string, merge: boolean) => {
  if (!merge || !existing?.trim()) return text;
  const block = `<!-- context-pack:begin -->\n${text.trim()}\n<!-- context-pack:end -->`;
  if (BLOCK.test(existing)) return existing.replace(BLOCK, () => block);
  return `${existing.trimEnd()}\n\n${block}\n`;
};

const readSkills = Effect.fnUntraced(function* (skillsDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!(yield* fs.exists(skillsDir))) return [];
  const names = (yield* fs.readDirectory(skillsDir)).toSorted();
  const skills: Array<Pack["skills"][number]> = [];
  for (const name of names) {
    const dir = path.join(skillsDir, name);
    if (yield* fs.exists(path.join(dir, "SKILL.md"))) skills.push({ name, dir });
  }
  return skills;
});

const writeSkills = Effect.fnUntraced(function* (skills: Pack["skills"], skillsDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const skill of skills) {
    yield* fs.copy(skill.dir, path.join(skillsDir, skill.name), { overwrite: true });
  }
});

export const writePackDir = Effect.fn("ContextPack.writePackDir")(function* (
  pack: Pack,
  outDir: string,
  meta: Pick<typeof Manifest.Type, "name" | "createdAt" | "source">,
) {
  const path = yield* Path.Path;
  const manifest: typeof Manifest.Type = {
    version: 1,
    ...meta,
    instructions: "instructions.md",
    skills: pack.skills.map((skill) => skill.name),
    mcp: "mcp.json",
  };
  yield* writeText(path.join(outDir, "pack.json"), yield* encodeManifest(manifest));
  yield* writeText(path.join(outDir, manifest.instructions), pack.instructions);
  yield* writeSkills(pack.skills, path.join(outDir, "skills"));
  const mcp = yield* encodeMcpFile({ servers: pack.mcp });
  yield* writeText(path.join(outDir, manifest.mcp), mcp);
});

export const readPackDir = Effect.fn("ContextPack.readPackDir")(function* (packDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const at = (rel: string) => path.join(packDir, rel);
  const manifest = yield* decodeManifest(yield* fs.readFileString(at("pack.json")));
  const mcp = yield* decodeMcpFile(yield* fs.readFileString(at(manifest.mcp)));
  const skills = (yield* readSkills(at("skills"))).filter((s) => manifest.skills.includes(s.name));
  const instructions = yield* fs.readFileString(at(manifest.instructions));
  return { instructions, skills, mcp: mcp.servers } satisfies Pack;
});
