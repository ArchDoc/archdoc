import { z } from "zod";
import { IdSchema, JourneyStepSchema, RefSchema } from "./schema.js";

/**
 * Where plans live, inside the model directory (`.archdoc/plans/`). A plan
 * is a proposal on top of the model, never part of it: nothing in it changes
 * the model until it's carried out.
 */
export const PLAN_DIR = "plans";

/** Where a plan stands. */
export const PlanStatusSchema = z
  .enum(["drafting", "reviewing", "ready", "executing", "done", "abandoned"])
  .describe(
    "drafting: the person is saying what they want. reviewing: sent to the agent to review. ready: agreed, with tasks to carry it out. executing: being carried out. done: carried out. abandoned: dropped, kept for why.",
  );

/** Whose an item is, and whether it's agreed. */
export const PlanItemStatusSchema = z
  .enum(["proposed", "suggested", "dismissed"])
  .describe(
    "proposed: part of the plan (the default). suggested: proposed by the agent, not yet accepted. dismissed: a suggestion the person turned down, kept so it isn't suggested again.",
  );

/** Who wrote something: human:@handle, or agent:<name>. */
export const PlanAuthorSchema = z
  .string()
  .min(1)
  .describe("Who wrote it: human:@handle, or agent:<name> such as agent:claude-code");

/** Where the person put something on the map, so it stays there. */
export const PlanPositionSchema = z
  .strictObject({ x: z.number(), y: z.number() })
  .describe("Where it sits on the map");

const Intent = z
  .string()
  .describe("Why: what the person means this to do. Every change and step needs one.");

/** The person's intents an item carries out. */
const For = z
  .array(IdSchema)
  .describe("The person's intents it carries out, by ID (i1): how the agent answers an intent");

const itemShape = {
  id: IdSchema.describe("The item's ID in this plan, such as c1"),
  intent: Intent.optional(),
  for: For.optional(),
  by: PlanAuthorSchema.optional(),
  status: PlanItemStatusSchema.optional(),
  at: PlanPositionSchema.optional(),
};

/**
 * What the person wants, in their words, pinned where they clicked on the
 * map. The person writes intents; the agent works out the architecture that
 * carries each one out, as suggested changes and sequences that name it in
 * `for`.
 */
export const PlanIntentSchema = z
  .strictObject({
    id: IdSchema.describe("The intent's ID in this plan, such as i1"),
    on: z
      .string()
      .optional()
      .describe(
        "The box the person clicked in: a model ID (web), or something the plan adds. Omit for the system as a whole.",
      ),
    to: z
      .string()
      .optional()
      .describe(
        "For an intent about how two boxes connect: the other box (on → to), from an arrow the person clicked or a drag from on to it, whether or not they're connected yet",
      ),
    at: PlanPositionSchema.optional().describe(
      "Where in that box, as percentages of its width and height (0-100), or on the map without on",
    ),
    by: PlanAuthorSchema.optional(),
    text: z.string().min(1).describe("What the person wants there, in their words"),
    resolved: z
      .boolean()
      .optional()
      .describe("Settled: the person is happy with how the plan carries it out, or dropped it"),
  })
  .describe("What the person wants, pinned where they clicked on the map");

/** A new element, actor, data entry, or journey: its ID and, beside it, its spec. */
const AddSchema = z
  .looseObject({
    id: RefSchema.describe(
      "The full ID it gets: an element inside its parent (web.pdf-export), an actor, a data entry",
    ),
    type: z.enum(["element", "actor", "journey", "data", "environment", "node"]).optional(),
  })
  .describe("Adds one thing: its ID, and its fields as archdoc edit would write them");

const SetSchema = z
  .looseObject({
    id: RefSchema,
    type: z.enum(["element", "actor", "journey", "data", "environment", "node"]).optional(),
  })
  .describe("Changes fields of one thing: its ID, and the fields to merge (null removes one)");

const RemoveSchema = z
  .union([
    RefSchema,
    z.strictObject({
      id: RefSchema,
      type: z.enum(["element", "actor", "journey", "data", "environment", "node"]).optional(),
    }),
  ])
  .describe("Removes one thing (an element with its children and the uses that point at it)");

const RenameSchema = z
  .strictObject({
    id: RefSchema,
    to: z.string().min(1).describe("The new ID: without a dot, renamed in place; dotted, moved"),
    type: z.enum(["element", "actor", "journey", "data", "environment", "node"]).optional(),
  })
  .describe("Renames or moves one thing");

const UseSchema = z
  .looseObject({
    from: RefSchema,
    to: RefSchema,
    remove: z.boolean().optional(),
  })
  .describe("Adds (or, with remove: true, removes) an arrow: from uses to, with its fields");

/**
 * One change the plan makes to the model, written as the `archdoc edit` op it
 * becomes: exactly one of add, set, remove, rename, or use.
 */
export const PlanChangeSchema = z
  .strictObject({
    ...itemShape,
    add: AddSchema.optional(),
    set: SetSchema.optional(),
    remove: RemoveSchema.optional(),
    rename: RenameSchema.optional(),
    use: UseSchema.optional(),
  })
  .refine(
    (c) => [c.add, c.set, c.remove, c.rename, c.use].filter((v) => v !== undefined).length === 1,
    { message: "A change is exactly one of add, set, remove, rename, or use" },
  )
  .describe("One change to the model, with the intent behind it");

/** A hop in a planned sequence: a journey step, with the intent behind it. */
export const PlanStepSchema = JourneyStepSchema.extend({
  intent: Intent.optional(),
  by: PlanAuthorSchema.optional(),
  status: PlanItemStatusSchema.optional(),
});

/**
 * A sequence of interactions: a new journey, or (when `journey` names one the
 * model has) the new steps of an existing one.
 */
export const PlanSequenceSchema = z
  .strictObject({
    ...itemShape,
    journey: IdSchema.describe(
      "The journey it becomes: a new ID, or an existing journey whose steps it replaces",
    ),
    name: z.string().optional(),
    actor: RefSchema.optional().describe("Whose goal it serves. Required for a new journey."),
    goal: z.string().optional().describe("What they're doing. Required for a new journey."),
    steps: z.array(PlanStepSchema).describe("The hops, in order, each with its intent"),
  })
  .describe("A sequence of interactions the plan adds or changes");

/** What a note is for. */
export const PlanNoteKindSchema = z
  .enum(["note", "insight", "question", "risk", "answer"])
  .describe(
    "note: a remark (the default). insight: something the agent found. question: needs an answer before the plan is ready. risk: what could go wrong. answer: a reply that settles a question.",
  );

export const PlanReplySchema = z.strictObject({
  by: PlanAuthorSchema.optional(),
  kind: PlanNoteKindSchema.optional(),
  text: z.string().min(1),
});

/** A note pinned to an item, an element, a step, or the canvas, with its thread of replies. */
export const PlanNoteSchema = z
  .strictObject({
    id: IdSchema,
    on: z
      .string()
      .optional()
      .describe(
        "What it's about: an intent (i1), a change or sequence ID (c1), a step (s1#2), or a model ID (web.journey-view). Omit for the canvas.",
      ),
    at: PlanPositionSchema.optional(),
    by: PlanAuthorSchema.optional(),
    kind: PlanNoteKindSchema.optional(),
    text: z.string().min(1),
    options: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "For a question: the choices, each a few words with its cost (Headless Chromium, 150 MB), shown as buttons the person taps to answer",
      ),
    replies: z.array(PlanReplySchema).optional(),
    resolved: z.boolean().optional(),
  })
  .describe("A note, question, or insight, and its replies");

/** Where a task stands. */
export const PlanTaskStatusSchema = z.enum(["todo", "doing", "done", "skipped"]);

/** One step of carrying the plan out, small enough for one commit. */
export const PlanTaskSchema = z
  .strictObject({
    id: IdSchema,
    title: z.string().min(1),
    from: z
      .array(z.string().min(1))
      .optional()
      .describe("The changes and sequences it carries out, by ID"),
    files: z.array(z.string().min(1)).optional().describe("The files it changes or adds"),
    tests: z.array(z.string().min(1)).optional().describe("The tests that show it works"),
    after: z.array(IdSchema).optional().describe("Tasks that come first"),
    status: PlanTaskStatusSchema.optional(),
    note: z.string().optional(),
  })
  .describe("One step of carrying out the plan");

/** What the person changed since the agent last read the plan. */
export const PlanUnreadSchema = z.strictObject({
  id: z.string().min(1).describe("The item: an intent, change, sequence, step (s1#2), or note"),
  what: z.enum(["added", "edited", "removed", "accepted", "dismissed", "replied"]),
});

/** The model the plan starts from: what `archdoc context` found for the goal. */
export const PlanScopeSchema = z
  .strictObject({
    elements: z.array(z.string()).optional(),
    journeys: z.array(z.string()).optional(),
    data: z.array(z.string()).optional(),
    actors: z.array(z.string()).optional(),
  })
  .describe("The parts of the model the goal touches, as the plan started");

/**
 * A plan (`.archdoc/plans/<id>.yaml`): a change designed with the agent
 * before it's built, as changes to the model, sequences of interactions, and
 * notes, each with the person's intent, and, once agreed, the tasks that
 * carry it out. Never loaded into the model.
 */
export const PlanFileSchema = z.strictObject({
  $schema: z.string().optional(),
  archdoc: z
    .string()
    .regex(/^2(\.\d+)?$/)
    .optional(),
  plan: IdSchema.describe("The plan's ID, usually its file name"),
  title: z.string().min(1).describe("The change in one line"),
  status: PlanStatusSchema.optional().describe("Where the plan stands. Defaults to drafting."),
  goal: z.string().optional().describe("The idea, as the person put it"),
  by: PlanAuthorSchema.optional(),
  scope: PlanScopeSchema.optional(),
  intents: z.array(PlanIntentSchema).optional(),
  changes: z.array(PlanChangeSchema).optional(),
  sequences: z.array(PlanSequenceSchema).optional(),
  notes: z.array(PlanNoteSchema).optional(),
  tasks: z.array(PlanTaskSchema).optional(),
  unread: z
    .array(PlanUnreadSchema)
    .optional()
    .describe("What the person changed since the agent last read the plan; reading clears it"),
  sent: z
    .number()
    .int()
    .optional()
    .describe("How many times the person has sent the plan to the agent"),
  seen: z.number().int().optional().describe("The round (sent) the agent last read"),
  answered: z
    .number()
    .int()
    .optional()
    .describe(
      "The round (sent) the agent last answered: while sent is ahead of it, it's the agent's turn",
    ),
});

export type PlanStatus = z.infer<typeof PlanStatusSchema>;
export type PlanItemStatus = z.infer<typeof PlanItemStatusSchema>;
export type PlanIntentSpec = z.infer<typeof PlanIntentSchema>;
export type PlanChangeSpec = z.infer<typeof PlanChangeSchema>;
export type PlanStepSpec = z.infer<typeof PlanStepSchema>;
export type PlanSequenceSpec = z.infer<typeof PlanSequenceSchema>;
export type PlanNoteSpec = z.infer<typeof PlanNoteSchema>;
export type PlanNoteKind = z.infer<typeof PlanNoteKindSchema>;
export type PlanReplySpec = z.infer<typeof PlanReplySchema>;
export type PlanTaskSpec = z.infer<typeof PlanTaskSchema>;
export type PlanUnreadSpec = z.infer<typeof PlanUnreadSchema>;
export type PlanFile = z.infer<typeof PlanFileSchema>;
