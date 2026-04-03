/**
 * Security Audit Logging
 * 
 * Comprehensive logging for security events including:
 * - Authentication attempts (success/failure)
 * - Authorization failures
 * - Rate limit violations
 * - CSRF violations
 * - Sensitive data access
 * - Configuration changes
 */

import { prisma } from "./prisma";

export type SecurityEventType =
  | "auth:login_success"
  | "auth:login_failure"
  | "auth:logout"
  | "auth:signup"
  | "auth:password_reset"
  | "auth:password_change"
  | "auth:oauth_connect"
  | "auth:oauth_disconnect"
  | "auth:2fa_enabled"
  | "auth:2fa_disabled"
  | "auth:token_refresh"
  | "auth:session_expired"
  | "auth:session_revoked"
  | "authorize:permission_denied"
  | "authorize:role_required"
  | "authorize:unauthorized_access"
  | "csrf:missing_token"
  | "csrf:invalid_token"
  | "csrf:validation_failed"
  | "rate_limit:exceeded"
  | "rate_limit:blocked"
  | "request:invalid_signature"
  | "request:expired_signature"
  | "request:replay_detected"
  | "data:sensitive_access"
  | "data:bulk_export"
  | "data:deletion"
  | "admin:config_change"
  | "admin:user_suspend"
  | "admin:user_unsuspend"
  | "admin:role_change"
  | "system:api_key_created"
  | "system:api_key_revoked"
  | "system:webhook_created"
  | "system:webhook_deleted";

export interface AuditLogEntry {
  id?: string;
  timestamp: Date;
  eventType: SecurityEventType;
  userId?: string;
  email?: string;
  ip: string;
  userAgent?: string;
  metadata: Record<string, unknown>;
  severity: "info" | "warning" | "error" | "critical";
  success: boolean;
}

export interface AuditLoggerOptions {
  /**
   * Store audit logs in database (default: true)
   */
  persistToDb?: boolean;
  
  /**
   * Log to console (default: true in dev)
   */
  logToConsole?: boolean;
  
  /**
   * Forward to external SIEM (default: false)
   */
  forwardToSiem?: boolean;
  
  /**
   * Minimum severity to persist (default: info)
   */
  minSeverity?: "info" | "warning" | "error" | "critical";
}

// Default options
const defaultOptions: AuditLoggerOptions = {
  persistToDb: true,
  logToConsole: process.env.NODE_ENV !== "production",
  forwardToSiem: false,
  minSeverity: "info",
};

// In-memory buffer for batching writes
const auditBuffer: AuditLogEntry[] = [];
let flushTimeout: NodeJS.Timeout | null = null;
const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 5000;

/**
 * Log a security event
 */
export async function logSecurityEvent(
  event: Omit<AuditLogEntry, "id" | "timestamp">,
  options: AuditLoggerOptions = {}
): Promise<void> {
  const opts = { ...defaultOptions, ...options };
  const entry: AuditLogEntry = {
    ...event,
    timestamp: new Date(),
    id: crypto.randomUUID(),
  };
  
  // Console logging
  if (opts.logToConsole) {
    console.log("[Security Audit]", {
      type: entry.eventType,
      user: entry.email || entry.userId || "anonymous",
      ip: entry.ip,
      severity: entry.severity,
      success: entry.success,
      metadata: entry.metadata,
    });
  }
  
  // Check severity threshold
  const severityLevels = ["info", "warning", "error", "critical"];
  if (severityLevels.indexOf(entry.severity) < severityLevels.indexOf(opts.minSeverity!)) {
    return;
  }
  
  // Database persistence
  if (opts.persistToDb) {
    auditBuffer.push(entry);
    scheduleFlush();
    
    // Immediate flush for critical events
    if (entry.severity === "critical") {
      await flushAuditBuffer();
    }
  }
  
  // External SIEM forwarding (placeholder)
  if (opts.forwardToSiem) {
    forwardToSiem(entry);
  }
}

/**
 * Schedule buffer flush
 */
function scheduleFlush(): void {
  if (flushTimeout) return;
  
  flushTimeout = setTimeout(() => {
    flushAuditBuffer().catch(console.error);
  }, FLUSH_INTERVAL_MS);
  
  // Also flush immediately if buffer is full
  if (auditBuffer.length >= BATCH_SIZE) {
    flushAuditBuffer().catch(console.error);
  }
}

/**
 * Flush audit buffer to database
 */
async function flushAuditBuffer(): Promise<void> {
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }
  
  if (auditBuffer.length === 0) return;
  
  const batch = auditBuffer.splice(0, auditBuffer.length);
  
  try {
    await prisma.$transaction(
      batch.map((entry) =>
        prisma.auditLog.create({
          data: {
            eventType: entry.eventType,
            userId: entry.userId,
            email: entry.email,
            ip: entry.ip,
            userAgent: entry.userAgent,
            metadata: entry.metadata as unknown as object,
            severity: entry.severity,
            success: entry.success,
            timestamp: entry.timestamp,
          },
        })
      ) as any[]
    );
  } catch (error) {
    console.error("[Security Audit] Failed to persist audit logs:", error);
    // Re-add to buffer for retry
    auditBuffer.unshift(...batch);
  }
}

/**
 * Extract request context for audit logging
 */
export function getAuditContext(req: Request): {
  ip: string;
  userAgent: string;
} {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  const userAgent = req.headers.get("user-agent") || "unknown";
  
  return { ip, userAgent };
}

/**
 * Log authentication event
 */
export async function logAuth(
  type: "login_success" | "login_failure" | "logout" | "signup" | "password_reset" | "password_change",
  req: Request,
  details: {
    userId?: string;
    email?: string;
    reason?: string;
    provider?: string;
  }
): Promise<void> {
  const { ip, userAgent } = getAuditContext(req);
  
  await logSecurityEvent({
    eventType: `auth:${type}` as SecurityEventType,
    userId: details.userId,
    email: details.email,
    ip,
    userAgent,
    metadata: {
      reason: details.reason,
      provider: details.provider,
    },
    severity: type === "login_failure" ? "warning" : "info",
    success: type !== "login_failure",
  });
}

/**
 * Log authorization failure
 */
export async function logAuthorization(
  req: Request,
  details: {
    userId?: string;
    email?: string;
    resource: string;
    action: string;
    reason: string;
  }
): Promise<void> {
  const { ip, userAgent } = getAuditContext(req);
  
  await logSecurityEvent({
    eventType: "authorize:permission_denied",
    userId: details.userId,
    email: details.email,
    ip,
    userAgent,
    metadata: {
      resource: details.resource,
      action: details.action,
      reason: details.reason,
    },
    severity: "warning",
    success: false,
  });
}

/**
 * Log rate limit violation
 */
export async function logRateLimit(
  req: Request,
  details: {
    userId?: string;
    endpoint: string;
    limit: number;
    blocked: boolean;
  }
): Promise<void> {
  const { ip, userAgent } = getAuditContext(req);
  
  await logSecurityEvent({
    eventType: details.blocked ? "rate_limit:blocked" : "rate_limit:exceeded",
    userId: details.userId,
    ip,
    userAgent,
    metadata: {
      endpoint: details.endpoint,
      limit: details.limit,
    },
    severity: details.blocked ? "error" : "warning",
    success: false,
  });
}

/**
 * Log CSRF violation
 */
export async function logCsrfViolation(
  req: Request,
  details: {
    type: "missing" | "invalid" | "validation_failed";
    reason?: string;
  }
): Promise<void> {
  const { ip, userAgent } = getAuditContext(req);
  
  const eventMap: Record<string, SecurityEventType> = {
    missing: "csrf:missing_token",
    invalid: "csrf:invalid_token",
    validation_failed: "csrf:validation_failed",
  };
  
  await logSecurityEvent({
    eventType: eventMap[details.type],
    ip,
    userAgent,
    metadata: { reason: details.reason },
    severity: "error",
    success: false,
  });
}

/**
 * Log sensitive data access
 */
export async function logSensitiveAccess(
  req: Request,
  details: {
    userId: string;
    email: string;
    resource: string;
    action: "read" | "write" | "delete" | "export";
    recordCount?: number;
  }
): Promise<void> {
  const { ip, userAgent } = getAuditContext(req);
  
  await logSecurityEvent({
    eventType: details.action === "export" ? "data:bulk_export" : "data:sensitive_access",
    userId: details.userId,
    email: details.email,
    ip,
    userAgent,
    metadata: {
      resource: details.resource,
      action: details.action,
      recordCount: details.recordCount,
    },
    severity: details.action === "delete" ? "warning" : "info",
    success: true,
  });
}

/**
 * Forward to external SIEM (placeholder implementation)
 */
function forwardToSiem(entry: AuditLogEntry): void {
  // Placeholder for SIEM integration
  // Example: Splunk, Datadog, ELK stack, etc.
  const siemUrl = process.env.SIEM_WEBHOOK_URL;
  if (!siemUrl) return;
  
  fetch(siemUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  }).catch(() => {
    // Fail silently - don't block on SIEM errors
  });
}

/**
 * Query audit logs (for admin/security review)
 */
export async function queryAuditLogs(options: {
  userId?: string;
  eventType?: SecurityEventType;
  severity?: "info" | "warning" | "error" | "critical";
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}): Promise<AuditLogEntry[]> {
  const { limit = 100, offset = 0, ...filters } = options;
  
  try {
    const logs = await prisma.auditLog.findMany({
      where: filters,
      orderBy: { timestamp: "desc" },
      take: limit,
      skip: offset,
    });
    
    return (logs as unknown as AuditLogEntry[]) || [];
  } catch {
    return [];
  }
}
