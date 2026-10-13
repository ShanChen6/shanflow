import { z } from 'zod';

export const PROJECT_NAME_MAX_LENGTH = 80;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 2000;
/** A workspace holds at most this many projects (active and archived), so a list always fits in one response. */
export const MAX_PROJECTS_PER_WORKSPACE = 200;

/** Presentation allowlists (blueprint: "application allowlist"). The UI maps each value to a style; unknown values are rejected. */
export const PROJECT_COLORS = ['slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'] as const;
export const PROJECT_ICONS = ['folder', 'briefcase', 'book', 'home', 'star', 'rocket', 'heart', 'flag'] as const;
export const PROJECT_STATUS_FILTERS = ['active', 'archived', 'all'] as const;

/** Trimmed, NFC-normalised and free of control or invisible formatting characters. */
export const projectNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(PROJECT_NAME_MAX_LENGTH)
  .refine((value) => !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value))
  .transform((value) => value.normalize('NFC'));

/** Free text: line breaks and tabs are allowed, other control/invisible characters are not. Blank means "no description". */
export const projectDescriptionSchema = z
  .string()
  .max(PROJECT_DESCRIPTION_MAX_LENGTH)
  .refine((value) => !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value.replace(/[\n\t]/g, '')))
  .transform((value) => value.normalize('NFC').trim())
  .transform((value) => (value === '' ? null : value));

export const projectSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  color: z.enum(PROJECT_COLORS).nullable(),
  icon: z.enum(PROJECT_ICONS).nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const createProjectRequestSchema = z
  .object({
    name: projectNameSchema,
    description: projectDescriptionSchema.optional(),
    color: z.enum(PROJECT_COLORS).nullable().optional(),
    icon: z.enum(PROJECT_ICONS).nullable().optional(),
  })
  .strict();

/** Partial update; `null` clears description, color or icon. Unknown fields (workspaceId, archivedAt…) are errors. */
export const updateProjectRequestSchema = z
  .object({
    name: projectNameSchema,
    description: projectDescriptionSchema,
    color: z.enum(PROJECT_COLORS).nullable(),
    icon: z.enum(PROJECT_ICONS).nullable(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field');

export const listProjectsQuerySchema = z.object({ status: z.enum(PROJECT_STATUS_FILTERS).default('active') }).strict();

export const projectResponseSchema = z.object({ project: projectSchema });
export const listProjectsResponseSchema = z.object({ projects: z.array(projectSchema) });

export type Project = z.infer<typeof projectSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
export type ProjectResponse = z.infer<typeof projectResponseSchema>;
export type ListProjectsResponse = z.infer<typeof listProjectsResponseSchema>;
