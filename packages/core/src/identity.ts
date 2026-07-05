import { randomBytes } from "node:crypto";

export type WorkspaceRole = "owner" | "admin" | "operator" | "viewer";
export type WorkspaceAction = "read" | "write" | "admin";
export type SecretAction = "describe" | "read" | "write" | "admin";

export interface UserRecord {
  id: string;
  displayName?: string;
  email?: string;
  disabled?: boolean;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface UpsertUserInput {
  id: string;
  displayName?: string;
  email?: string;
  disabled?: boolean;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceGrant {
  id: string;
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  grantedAt: string;
  grantedBy?: string;
  expiresAt?: string;
}

export interface WorkspaceGrantInput {
  id?: string;
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  grantedAt?: string;
  grantedBy?: string;
  expiresAt?: string;
}

export type SecretGrantTarget =
  | {
      type: "user";
      userId: string;
    }
  | {
      type: "role";
      role: WorkspaceRole;
    };

export interface SecretGrant {
  id: string;
  workspaceId: string;
  secretId: string;
  target: SecretGrantTarget;
  permissions: SecretAction[];
  grantedAt: string;
  grantedBy?: string;
  expiresAt?: string;
}

export interface SecretGrantInput {
  id?: string;
  workspaceId: string;
  secretId: string;
  target: SecretGrantTarget;
  permissions: SecretAction[];
  grantedAt?: string;
  grantedBy?: string;
  expiresAt?: string;
}

export interface WorkspaceAccessRequest {
  userId: string;
  workspaceId: string;
  action: WorkspaceAction;
  at?: Date;
}

export interface SecretGrantAccessRequest {
  userId: string;
  workspaceId: string;
  secretId: string;
  action: SecretAction;
  at?: Date;
}

export interface AccessDecision {
  allowed: boolean;
  userId: string;
  workspaceId: string;
  action: WorkspaceAction | SecretAction;
  reason?: string;
  role?: WorkspaceRole;
  grantId?: string;
  secretId?: string;
}

export interface InMemoryIdentityStoreOptions {
  now?: () => Date;
}

const WORKSPACE_ROLE_ACTIONS: Record<WorkspaceRole, readonly WorkspaceAction[]> = {
  owner: ["read", "write", "admin"],
  admin: ["read", "write", "admin"],
  operator: ["read", "write"],
  viewer: ["read"]
};

const WORKSPACE_ADMIN_ROLES = new Set<WorkspaceRole>(["owner", "admin"]);

export class AccessDeniedError extends Error {
  readonly decision: AccessDecision;

  constructor(decision: AccessDecision) {
    super(decision.reason ?? "access_denied");
    this.name = "AccessDeniedError";
    this.decision = decision;
  }
}

export class InMemoryIdentityStore {
  private readonly users = new Map<string, UserRecord>();
  private readonly workspaceGrants = new Map<string, WorkspaceGrant>();
  private readonly secretGrants = new Map<string, SecretGrant>();
  private readonly now: () => Date;

  constructor(options: InMemoryIdentityStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  upsertUser(input: UpsertUserInput): UserRecord {
    assertNonEmpty(input.id, "user id");
    const existing = this.users.get(input.id);
    const user: UserRecord = {
      id: input.id,
      displayName: input.displayName ?? existing?.displayName,
      email: input.email ?? existing?.email,
      disabled: input.disabled ?? existing?.disabled ?? false,
      createdAt: input.createdAt ?? existing?.createdAt ?? this.now().toISOString(),
      metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) }
    };
    this.users.set(user.id, user);
    return cloneUser(user);
  }

  getUser(userId: string): UserRecord | undefined {
    const user = this.users.get(userId);
    return user ? cloneUser(user) : undefined;
  }

  grantWorkspace(input: WorkspaceGrantInput): WorkspaceGrant {
    assertNonEmpty(input.userId, "user id");
    assertNonEmpty(input.workspaceId, "workspace id");
    this.ensureUser(input.userId);

    const grant: WorkspaceGrant = {
      id: input.id ?? createGrantId("workspace_grant"),
      userId: input.userId,
      workspaceId: input.workspaceId,
      role: input.role,
      grantedAt: input.grantedAt ?? this.now().toISOString(),
      grantedBy: input.grantedBy,
      expiresAt: input.expiresAt
    };
    this.workspaceGrants.set(grant.id, grant);
    return cloneWorkspaceGrant(grant);
  }

  revokeWorkspaceGrant(grantId: string): boolean {
    return this.workspaceGrants.delete(grantId);
  }

  grantSecret(input: SecretGrantInput): SecretGrant {
    assertNonEmpty(input.workspaceId, "workspace id");
    assertNonEmpty(input.secretId, "secret id");
    if (input.target.type === "user") {
      assertNonEmpty(input.target.userId, "target user id");
      this.ensureUser(input.target.userId);
    }
    const permissions = normalizeSecretPermissions(input.permissions);
    if (permissions.length === 0) {
      throw new Error("secret grant must include at least one permission");
    }

    const grant: SecretGrant = {
      id: input.id ?? createGrantId("secret_grant"),
      workspaceId: input.workspaceId,
      secretId: input.secretId,
      target: cloneSecretGrantTarget(input.target),
      permissions,
      grantedAt: input.grantedAt ?? this.now().toISOString(),
      grantedBy: input.grantedBy,
      expiresAt: input.expiresAt
    };
    this.secretGrants.set(grant.id, grant);
    return cloneSecretGrant(grant);
  }

  revokeSecretGrant(grantId: string): boolean {
    return this.secretGrants.delete(grantId);
  }

  listWorkspaceGrants(userId?: string, workspaceId?: string): WorkspaceGrant[] {
    return [...this.workspaceGrants.values()]
      .filter((grant) => (userId ? grant.userId === userId : true))
      .filter((grant) => (workspaceId ? grant.workspaceId === workspaceId : true))
      .map(cloneWorkspaceGrant);
  }

  listSecretGrants(workspaceId?: string, secretId?: string): SecretGrant[] {
    return [...this.secretGrants.values()]
      .filter((grant) => (workspaceId ? grant.workspaceId === workspaceId : true))
      .filter((grant) => (secretId ? grant.secretId === secretId : true))
      .map(cloneSecretGrant);
  }

  rolesForUser(userId: string, workspaceId: string, at = this.now()): WorkspaceRole[] {
    if (!this.isActiveUser(userId)) {
      return [];
    }
    const roles = new Set<WorkspaceRole>();
    for (const grant of this.workspaceGrants.values()) {
      if (grant.userId === userId && grant.workspaceId === workspaceId && isGrantActive(grant, at)) {
        roles.add(grant.role);
      }
    }
    return [...roles];
  }

  canAccessWorkspace(request: WorkspaceAccessRequest): AccessDecision {
    const at = request.at ?? this.now();
    const inactiveReason = this.getInactiveUserReason(request.userId);
    if (inactiveReason) {
      return denyWorkspace(request, inactiveReason);
    }

    for (const grant of this.workspaceGrants.values()) {
      if (
        grant.userId === request.userId &&
        grant.workspaceId === request.workspaceId &&
        isGrantActive(grant, at) &&
        roleAllowsWorkspaceAction(grant.role, request.action)
      ) {
        return {
          allowed: true,
          userId: request.userId,
          workspaceId: request.workspaceId,
          action: request.action,
          role: grant.role,
          grantId: grant.id
        };
      }
    }

    return denyWorkspace(request, "missing_workspace_grant");
  }

  requireWorkspaceAccess(request: WorkspaceAccessRequest): AccessDecision {
    const decision = this.canAccessWorkspace(request);
    if (!decision.allowed) {
      throw new AccessDeniedError(decision);
    }
    return decision;
  }

  canAccessSecret(request: SecretGrantAccessRequest): AccessDecision {
    const at = request.at ?? this.now();
    const workspaceAction = workspaceActionForSecretAction(request.action);
    const workspaceDecision = this.canAccessWorkspace({ ...request, action: workspaceAction, at });
    if (!workspaceDecision.allowed) {
      return {
        ...workspaceDecision,
        action: request.action,
        secretId: request.secretId
      };
    }

    const roles = this.rolesForUser(request.userId, request.workspaceId, at);
    const adminRole = roles.find((role) => WORKSPACE_ADMIN_ROLES.has(role));
    if (adminRole) {
      return {
        allowed: true,
        userId: request.userId,
        workspaceId: request.workspaceId,
        secretId: request.secretId,
        action: request.action,
        role: adminRole,
        reason: "workspace_admin"
      };
    }

    for (const grant of this.secretGrants.values()) {
      if (
        grant.workspaceId === request.workspaceId &&
        grant.secretId === request.secretId &&
        isGrantActive(grant, at) &&
        secretTargetMatches(grant.target, request.userId, roles) &&
        secretPermissionsAllow(grant.permissions, request.action)
      ) {
        return {
          allowed: true,
          userId: request.userId,
          workspaceId: request.workspaceId,
          secretId: request.secretId,
          action: request.action,
          role: grant.target.type === "role" ? grant.target.role : workspaceDecision.role,
          grantId: grant.id
        };
      }
    }

    return {
      allowed: false,
      userId: request.userId,
      workspaceId: request.workspaceId,
      secretId: request.secretId,
      action: request.action,
      reason: "missing_secret_grant"
    };
  }

  requireSecretAccess(request: SecretGrantAccessRequest): AccessDecision {
    const decision = this.canAccessSecret(request);
    if (!decision.allowed) {
      throw new AccessDeniedError(decision);
    }
    return decision;
  }

  private ensureUser(userId: string): void {
    if (!this.users.has(userId)) {
      this.upsertUser({ id: userId });
    }
  }

  private isActiveUser(userId: string): boolean {
    return !this.getInactiveUserReason(userId);
  }

  private getInactiveUserReason(userId: string): string | undefined {
    const user = this.users.get(userId);
    if (!user) {
      return "unknown_user";
    }
    if (user.disabled) {
      return "disabled_user";
    }
    return undefined;
  }
}

function roleAllowsWorkspaceAction(role: WorkspaceRole, action: WorkspaceAction): boolean {
  return WORKSPACE_ROLE_ACTIONS[role].includes(action);
}

function workspaceActionForSecretAction(action: SecretAction): WorkspaceAction {
  if (action === "write") {
    return "write";
  }
  return "read";
}

function secretPermissionsAllow(permissions: readonly SecretAction[], action: SecretAction): boolean {
  if (permissions.includes("admin")) {
    return true;
  }
  if (action === "describe") {
    return permissions.includes("describe") || permissions.includes("read") || permissions.includes("write");
  }
  return permissions.includes(action);
}

function secretTargetMatches(target: SecretGrantTarget, userId: string, roles: readonly WorkspaceRole[]): boolean {
  if (target.type === "user") {
    return target.userId === userId;
  }
  return roles.includes(target.role);
}

function normalizeSecretPermissions(permissions: readonly SecretAction[]): SecretAction[] {
  return [...new Set(permissions)];
}

function isGrantActive(grant: { expiresAt?: string }, at: Date): boolean {
  if (!grant.expiresAt) {
    return true;
  }
  return Date.parse(grant.expiresAt) > at.getTime();
}

function denyWorkspace(request: WorkspaceAccessRequest, reason: string): AccessDecision {
  return {
    allowed: false,
    userId: request.userId,
    workspaceId: request.workspaceId,
    action: request.action,
    reason
  };
}

function cloneUser(user: UserRecord): UserRecord {
  return {
    ...user,
    metadata: { ...user.metadata }
  };
}

function cloneWorkspaceGrant(grant: WorkspaceGrant): WorkspaceGrant {
  return { ...grant };
}

function cloneSecretGrant(grant: SecretGrant): SecretGrant {
  return {
    ...grant,
    target: cloneSecretGrantTarget(grant.target),
    permissions: [...grant.permissions]
  };
}

function cloneSecretGrantTarget(target: SecretGrantTarget): SecretGrantTarget {
  return target.type === "user" ? { type: "user", userId: target.userId } : { type: "role", role: target.role };
}

function createGrantId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
}
