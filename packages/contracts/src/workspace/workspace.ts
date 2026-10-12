import { z } from 'zod';

export const WORKSPACE_NAME_MAX_LENGTH = 80;
export const WORKSPACE_TYPES = ['PERSONAL', 'TEAM'] as const;
export const WORKSPACE_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
/** Roles allowed to change workspace metadata (authorization matrix). */
export const WORKSPACE_MANAGER_ROLES = ['OWNER', 'ADMIN'] as const;

/** Trimmed, NFC-normalised, and free of control/invisible formatting characters (same rules as a display name). */
export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(WORKSPACE_NAME_MAX_LENGTH)
  .refine((value) => !/[\p{Cc}\p{Cf}  ]/u.test(value))
  .transform((value) => value.normalize('NFC'));

/** A workspace as seen by one member: `role` is the caller's own role in it. */
export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(WORKSPACE_TYPES),
  role: z.enum(WORKSPACE_ROLES),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const listWorkspacesResponseSchema = z.object({ workspaces: z.array(workspaceSchema) });
export const getWorkspaceResponseSchema = z.object({ workspace: workspaceSchema });

/** `.strict()`: anything but the name (owner, type, role…) is rejected rather than silently ignored. */
export const updateWorkspaceRequestSchema = z.object({ name: workspaceNameSchema }).strict();
export const updateWorkspaceResponseSchema = getWorkspaceResponseSchema;

/** Deliberately no email: members of a workspace do not get each other's contact details. */
export const workspaceMemberSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  role: z.enum(WORKSPACE_ROLES),
  joinedAt: z.iso.datetime(),
});
export const listMembersResponseSchema = z.object({ members: z.array(workspaceMemberSchema) });

export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export type ListWorkspacesResponse = z.infer<typeof listWorkspacesResponseSchema>;
export type GetWorkspaceResponse = z.infer<typeof getWorkspaceResponseSchema>;
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;
export type UpdateWorkspaceResponse = z.infer<typeof updateWorkspaceResponseSchema>;
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
export type ListMembersResponse = z.infer<typeof listMembersResponseSchema>;
