package cd.vmicro.credit.security;

import cd.vmicro.credit.service.AuditLogService;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.Set;

@Service
public class RbacAndAuditService {

    private static final Map<String, Set<String>> ROLE_PERMISSIONS = Map.of(
            "CLIENT", Set.of(),
            "SUPER_ADMIN", Set.of(
                    "ADMIN_VIEW_OVERVIEW", "ADMIN_MANAGE_USERS", "ADMIN_VERIFY_KYC",
                    "ADMIN_REVIEW_LOANS", "ADMIN_MANAGE_ROLES", "ADMIN_MANAGE_PROVIDERS",
                    "ADMIN_VIEW_AUDIT", "ADMIN_SEND_NOTIFICATIONS"
            ),
            "ADMIN", Set.of(
                    "ADMIN_VIEW_OVERVIEW", "ADMIN_MANAGE_USERS", "ADMIN_VERIFY_KYC",
                    "ADMIN_REVIEW_LOANS", "ADMIN_MANAGE_PROVIDERS",
                    "ADMIN_VIEW_AUDIT", "ADMIN_SEND_NOTIFICATIONS"
            ),
            "VERIFICATION_AGENT", Set.of("ADMIN_VIEW_OVERVIEW", "ADMIN_MANAGE_USERS", "ADMIN_VERIFY_KYC"),
            "CREDIT_AGENT", Set.of("ADMIN_VIEW_OVERVIEW", "ADMIN_REVIEW_LOANS"),
            "CLIENT_SUPPORT", Set.of("ADMIN_VIEW_OVERVIEW", "ADMIN_MANAGE_USERS", "ADMIN_SEND_NOTIFICATIONS"),
            "AUDITOR", Set.of("ADMIN_VIEW_OVERVIEW", "ADMIN_VIEW_AUDIT")
    );

    private final AuditLogService auditLogService;

    public RbacAndAuditService(AuditLogService auditLogService) {
        this.auditLogService = auditLogService;
    }

    public Set<String> getPermissionsForRole(String role) {
        return ROLE_PERMISSIONS.getOrDefault(role, Set.of());
    }

    public String extractRole(Authentication auth) {
        if (auth != null && auth.getCredentials() instanceof JwtService.JwtClaims claims) {
            return claims.role();
        }
        return "CLIENT";
    }

    public String extractSessionId(Authentication auth) {
        if (auth != null && auth.getCredentials() instanceof JwtService.JwtClaims claims) {
            return claims.sessionId();
        }
        return "";
    }

    public boolean hasPermission(Authentication auth, String permission) {
        return getPermissionsForRole(extractRole(auth)).contains(permission);
    }

    public void logAudit(String actorId, String actorRole, String action, String targetType, String targetId, Map<String, Object> metadata) {
        try {
            auditLogService.recordAudit(actorId, actorRole, action, targetType, targetId, metadata);
        } catch (Exception ignored) {
            // Keep audit resilient without crashing business transactions
        }
    }
}
