/**
 * 路由校验用的 TypeBox 片段。枚举一律取自 shared/constants.ts，
 * 与 openapi.yaml 中的约束保持一致。
 */
import { Type, type TLiteral, type TOptional, type TSchema, type TUnion } from '@sinclair/typebox';
import {
  CARD_SOURCES,
  CARD_STATES,
  DAY_MODES,
  FURIGANA_MODES,
  JLPT_LEVELS,
  STUDY_MODULES,
  TASK_STATUSES,
  THEMES,
  WEEKDAYS,
} from '../../shared/constants';

export const Lit = <T extends readonly (string | number)[]>(values: T) =>
  Type.Union(values.map((v) => Type.Literal(v))) as unknown as TUnion<TLiteral<T[number]>[]>;

export const Nullable = <T extends TSchema>(s: T) => Type.Union([s, Type.Null()]);

export const Uuid = Type.String({ format: 'uuid' });
export const IsoDate = Type.String({ format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
export const IsoDateTime = Type.String({ format: 'date-time' });
export const Url = Type.String({ format: 'uri', maxLength: 500 });

export const ClientOpId = Uuid;
export const WriteMeta = { clientOpId: ClientOpId };
export const VersionedMeta = { clientOpId: ClientOpId, baseVersion: Type.Optional(Type.Integer({ minimum: 1 })) };

export const IdParams = Type.Object({ id: Uuid });
export const DeleteQuery = Type.Object({
  clientOpId: ClientOpId,
  baseVersion: Type.Optional(Type.Integer({ minimum: 1 })),
});
export const PageQuery = {
  cursor: Type.Optional(Type.String({ maxLength: 500 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
};

export const StudyModule = Lit(STUDY_MODULES);
export const DayMode = Lit(DAY_MODES);
export const Weekday = Lit(WEEKDAYS);
export const TaskStatus = Lit(TASK_STATUSES);
export const JlptLevel = Lit(JLPT_LEVELS);
export const CardState = Lit(CARD_STATES);
export const CardSource = Lit(CARD_SOURCES);
export const ReviewRating = Type.Integer({ minimum: 1, maximum: 4 });

const Minutes = Nullable(Type.Integer({ minimum: 1, maximum: 600 }));
const Count = Nullable(Type.Integer({ minimum: 1, maximum: 10000 }));
const Title = Type.String({ minLength: 1, maxLength: 120 });
const Note = Nullable(Type.String({ maxLength: 1000 }));
const Tags = Type.Array(Type.String({ maxLength: 30 }), { maxItems: 20 });

/* ───────────── settings ───────────── */

export const SettingsData = Type.Object(
  {
    timezone: Type.String({ minLength: 1, maxLength: 64 }),
    weekPlan: Type.Object(
      { mon: DayMode, tue: DayMode, wed: DayMode, thu: DayMode, fri: DayMode, sat: DayMode, sun: DayMode },
      { additionalProperties: false },
    ),
    dailyGoalMinutes: Type.Integer({ minimum: 5, maximum: 600 }),
    jlptTarget: JlptLevel,
    newCardsPerDay: Type.Integer({ minimum: 0, maximum: 500 }),
    reviewLimitPerDay: Type.Integer({ minimum: 0, maximum: 5000 }),
    defaultDeck: Type.String({ minLength: 1, maxLength: 60 }),
    speechRate: Type.Number({ minimum: 0.5, maximum: 1.5 }),
    ttsVoice: Nullable(Type.String({ maxLength: 120 })),
    furiganaMode: Lit(FURIGANA_MODES),
    theme: Lit(THEMES),
    desiredRetention: Type.Number({ minimum: 0.7, maximum: 0.97 }),
  },
  { additionalProperties: false },
);

/* ───────────── tasks / templates ───────────── */

export const TaskFields = {
  title: Title,
  module: StudyModule,
  date: IsoDate,
  targetMinutes: Minutes,
  targetCount: Count,
  sortOrder: Type.Integer({ minimum: -100000, maximum: 100000 }),
  link: Nullable(Url),
  note: Note,
};

export const TemplateFields = {
  title: Title,
  module: StudyModule,
  dayModes: Type.Array(DayMode, { minItems: 1, uniqueItems: true }),
  weekdays: Type.Array(Weekday, { uniqueItems: true }),
  targetMinutes: Minutes,
  targetCount: Count,
  sortOrder: Type.Integer({ minimum: -100000, maximum: 100000 }),
  active: Type.Boolean(),
  link: Nullable(Url),
};

/* ───────────── cards ───────────── */

export const CardInput = Type.Object(
  {
    id: Type.Optional(Uuid),
    deck: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
    front: Type.String({ minLength: 1, maxLength: 500 }),
    back: Type.String({ minLength: 1, maxLength: 2000 }),
    reading: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
    example: Type.Optional(Nullable(Type.String({ maxLength: 1000 }))),
    exampleTranslation: Type.Optional(Nullable(Type.String({ maxLength: 1000 }))),
    tags: Type.Optional(Tags),
    source: Type.Optional(CardSource),
    sourceRef: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
    jlptLevel: Type.Optional(Nullable(JlptLevel)),
  },
  { additionalProperties: false },
);

export const CardPatchFields = {
  deck: Type.String({ minLength: 1, maxLength: 60 }),
  front: Type.String({ minLength: 1, maxLength: 500 }),
  back: Type.String({ minLength: 1, maxLength: 2000 }),
  reading: Nullable(Type.String({ maxLength: 500 })),
  example: Nullable(Type.String({ maxLength: 1000 })),
  exampleTranslation: Nullable(Type.String({ maxLength: 1000 })),
  tags: Tags,
  jlptLevel: Nullable(JlptLevel),
  suspended: Type.Boolean(),
};

/** 把一组字段全部变为可选，用于 PATCH */
export function partial<T extends Record<string, TSchema>>(fields: T) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, Type.Optional(v)])) as {
    [K in keyof T]: TOptional<T[K]>;
  };
}
