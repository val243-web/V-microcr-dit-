package cd.vmicro.credit.controller;

import cd.vmicro.credit.entity.LoanContractEntity;
import cd.vmicro.credit.security.RbacAndAuditService;
import cd.vmicro.credit.service.AuditLogService;
import cd.vmicro.credit.service.LoanContractService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/admin")
public class AdminController {

    private final JdbcTemplate jdbc;
    private final RbacAndAuditService rbacAudit;
    private final LoanContractService loanContractService;
    private final AuditLogService auditLogService;

    public AdminController(
            JdbcTemplate jdbc,
            RbacAndAuditService rbacAudit,
            LoanContractService loanContractService,
            AuditLogService auditLogService
    ) {
        this.jdbc = jdbc;
        this.rbacAudit = rbacAudit;
        this.loanContractService = loanContractService;
        this.auditLogService = auditLogService;
    }

    public record LoanDecisionBody(@NotBlank String decision, @NotBlank String note) {}
    public record ContractStatusBody(@NotBlank String status) {}

    @GetMapping("/overview")
    public ResponseEntity<Map<String, Object>> overview(Authentication auth) {
        if (!rbacAudit.hasPermission(auth, "ADMIN_VIEW_OVERVIEW")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Permission insuffisante."));
        }
        Integer totalUsers = jdbc.queryForObject("SELECT COUNT(*) FROM users WHERE role = 'CLIENT'", Integer.class);
        Integer verifiedUsers = jdbc.queryForObject("SELECT COUNT(DISTINCT user_id) FROM identity_verifications WHERE status = 'VERIFIED'", Integer.class);
        Integer totalLoanApps = jdbc.queryForObject("SELECT COUNT(*) FROM loan_applications", Integer.class);
        Integer pendingLoans = jdbc.queryForObject("SELECT COUNT(*) FROM loan_applications WHERE status = 'PENDING_REVIEW'", Integer.class);
        Integer approvedLoans = jdbc.queryForObject("SELECT COUNT(*) FROM loan_applications WHERE status = 'APPROVED'", Integer.class);
        Double totalSavings = jdbc.queryForObject("SELECT COALESCE(SUM(available_balance + locked_goals_balance), 0) FROM savings_accounts", Double.class);
        Double totalDisbursed = jdbc.queryForObject("SELECT COALESCE(SUM(principal_amount), 0) FROM loan_contracts", Double.class);
        Double totalRepaid = jdbc.queryForObject("SELECT COALESCE(SUM(amount), 0) FROM repayments", Double.class);
        Integer simulatedTxCount = jdbc.queryForObject("SELECT COUNT(*) FROM transactions WHERE is_simulated = TRUE", Integer.class);
        Integer realTxCount = jdbc.queryForObject("SELECT COUNT(*) FROM transactions WHERE is_simulated = FALSE", Integer.class);

        return ResponseEntity.ok(Map.of("kpis", Map.of(
                "totalUsers", totalUsers != null ? totalUsers : 0,
                "verifiedUsers", verifiedUsers != null ? verifiedUsers : 0,
                "totalLoanApps", totalLoanApps != null ? totalLoanApps : 0,
                "pendingLoans", pendingLoans != null ? pendingLoans : 0,
                "approvedLoans", approvedLoans != null ? approvedLoans : 0,
                "totalSavings", totalSavings != null ? totalSavings : 0.0,
                "totalDisbursed", totalDisbursed != null ? totalDisbursed : 0.0,
                "totalRepaid", totalRepaid != null ? totalRepaid : 0.0,
                "simulatedTxCount", simulatedTxCount != null ? simulatedTxCount : 0,
                "realTxCount", realTxCount != null ? realTxCount : 0
        )));
    }

    @GetMapping("/users")
    public ResponseEntity<Map<String, Object>> users(Authentication auth) {
        if (!rbacAudit.hasPermission(auth, "ADMIN_MANAGE_USERS")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Permission insuffisante."));
        }
        var users = jdbc.queryForList(
                """
                SELECT u.id, u.email, u.phone, u.role, u.phone_verified, u.status, u.created_at,
                       p.first_name, p.last_name, p.city, p.commune, p.profession,
                       COALESCE((SELECT status FROM identity_verifications iv WHERE iv.user_id = u.id ORDER BY iv.created_at DESC LIMIT 1), 'NOT_STARTED') as kyc_status
                FROM users u LEFT JOIN profiles p ON p.user_id = u.id ORDER BY u.created_at DESC
                """
        );
        return ResponseEntity.ok(Map.of("users", users));
    }

    @PutMapping("/users/{id}/kyc")
    @Transactional
    public ResponseEntity<Map<String, Object>> reviewKyc(@PathVariable String id, @RequestBody Map<String, String> body, Authentication auth) {
        if (!rbacAudit.hasPermission(auth, "ADMIN_VERIFY_KYC")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Permission insuffisante."));
        }
        String status = body.getOrDefault("status", "VERIFIED");
        String note = body.getOrDefault("note", "");
        var rows = jdbc.queryForList("SELECT id FROM identity_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1", id);
        if (rows.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Aucun dossier KYC trouvé."));
        }
        jdbc.update(
                "UPDATE identity_verifications SET status = ?, failure_reason = ?, reviewed_by = ?, updated_at = NOW() WHERE id = ?",
                status, "FAILED".equals(status) ? note : null, auth.getName(), rows.get(0).get("id")
        );
        rbacAudit.logAudit(auth.getName(), rbacAudit.extractRole(auth), "KYC_ADMIN_" + status, "USER", id, Map.of("note", note));
        return ResponseEntity.ok(Map.of("status", status, "reviewedBy", auth.getName()));
    }

    @PutMapping("/users/{id}/role")
    public ResponseEntity<Map<String, Object>> updateRole(@PathVariable String id, @RequestBody Map<String, String> body, Authentication auth) {
        if (!rbacAudit.hasPermission(auth, "ADMIN_MANAGE_ROLES")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Permission insuffisante."));
        }
        if (id.equals(auth.getName())) {
            return ResponseEntity.badRequest().body(Map.of("error", "Vous ne pouvez pas modifier votre propre rôle."));
        }
        String newRole = body.getOrDefault("role", "CLIENT");
        jdbc.update("UPDATE users SET role = ?, updated_at = NOW() WHERE id = ?", newRole, id);
        rbacAudit.logAudit(auth.getName(), rbacAudit.extractRole(auth), "ROLE_UPDATED", "USER", id, Map.of("newRole", newRole));
        return ResponseEntity.ok(Map.of("userId", id, "role", newRole));
    }

    @GetMapping("/loans")
    public ResponseEntity<Map<String, Object>> listLoans(Authentication auth) {
        if (!rbacAudit.hasPermission(auth, "ADMIN_REVIEW_LOANS")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Permission insuffisante."));
        }
        var loans = jdbc.queryForList(
                """
                SELECT la.*, p.first_name, p.last_name, p.city, u.phone,
                       sa.score, sa.risk_band, sa.debt_to_income_ratio, sa.disposable_income, sa.factors_json, sa.disclaimer
                FROM loan_applications la
                JOIN users u ON u.id = la.user_id
                LEFT JOIN profiles p ON p.user_id = la.user_id
                LEFT JOIN solvency_assessments sa ON sa.loan_application_id = la.id
                ORDER BY la.created_at DESC
                """
        );
        return ResponseEntity.ok(Map.of("loans", loans));
    }

    @PostMapping("/loans/{id}/decision")
    @Transactional
    public ResponseEntity<Map<String, Object>> decideLoan(
            @PathVariable String id,
            @Valid @RequestBody LoanDecisionBody body,
            Authentication auth
    ) {
        if (!rbacAudit.hasPermission(auth, "ADMIN_REVIEW_LOANS")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Permission insuffisante."));
        }
        if (!List.of("APPROVED", "REJECTED", "COMPLEMENT_REQUIRED").contains(body.decision())) {
            return ResponseEntity.badRequest().body(Map.of("error", "Décision invalide."));
        }

        var rows = jdbc.queryForList("SELECT * FROM loan_applications WHERE id = ?", id);
        if (rows.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Demande introuvable."));
        }
        Map<String, Object> appRow = rows.get(0);
        String currentStatus = String.valueOf(appRow.get("status"));
        if ("APPROVED".equals(currentStatus) || "REJECTED".equals(currentStatus)) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "Décision finale déjà rendue."));
        }

        jdbc.update(
                "UPDATE loan_applications SET status = ?, decision_note = ?, reviewed_by = ?, reviewed_at = NOW(), updated_at = NOW() WHERE id = ?",
                body.decision(), body.note(), auth.getName(), id
        );

        String applicantId = String.valueOf(appRow.get("user_id"));
        if ("APPROVED".equals(body.decision())) {
            BigDecimal amount = (BigDecimal) appRow.get("requested_amount");
            int months = ((Number) appRow.get("duration_months")).intValue();
            loanContractService.createApprovedContractWithSchedule(id, applicantId, amount, months);
        }

        jdbc.update(
                "INSERT INTO notifications (id, user_id, category, title, message, read) VALUES (?, ?, 'LOAN_DECISION', ?, ?, FALSE)",
                "ntf_" + UUID.randomUUID().toString().substring(0, 10),
                applicantId,
                "APPROVED".equals(body.decision()) ? "Demande de crédit approuvée" : "Décision sur votre demande de crédit",
                body.note()
        );

        rbacAudit.logAudit(auth.getName(), rbacAudit.extractRole(auth), "LOAN_DECISION_" + body.decision(), "LOAN_APPLICATION", id, Map.of("note", body.note()));
        return ResponseEntity.ok(Map.of("loanId", id, "decision", body.decision(), "note", body.note(), "reviewedBy", auth.getName()));
    }

    @GetMapping("/contracts")
    public ResponseEntity<Map<String, Object>> listContracts(Authentication auth) {
        if (!rbacAudit.hasPermission(auth, "ADMIN_REVIEW_LOANS")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Permission insuffisante."));
        }
        List<LoanContractEntity> contracts = loanContractService.listAllContractsAdmin();
        return ResponseEntity.ok(Map.of("contracts", contracts));
    }

    @GetMapping("/contracts/{id}")
    public ResponseEntity<Map<String, Object>> getContract(@PathVariable String id, Authentication auth) {
        if (!rbacAudit.hasPermission(auth, "ADMIN_REVIEW_LOANS")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Permission insuffisante."));
        }
        LoanContractEntity contract = loanContractService.getContractByIdAdmin(id);
        return ResponseEntity.ok(Map.of("contract", contract, "schedule", loanContractService.getSchedules(contract.getId())));
    }

    @PutMapping("/contracts/{id}/status")
    public ResponseEntity<Map<String, Object>> updateContractStatus(
            @PathVariable String id,
            @Valid @RequestBody ContractStatusBody body,
            Authentication auth
    ) {
        if (!rbacAudit.hasPermission(auth, "ADMIN_REVIEW_LOANS")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Permission insuffisante."));
        }
        LoanContractEntity updated = loanContractService.updateContractStatus(
                id, body.status(), auth.getName(), rbacAudit.extractRole(auth)
        );
        return ResponseEntity.ok(Map.of("contract", updated));
    }

    @GetMapping("/transactions")
    public ResponseEntity<Map<String, Object>> transactions(Authentication auth) {
        if (!rbacAudit.hasPermission(auth, "ADMIN_VIEW_OVERVIEW")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Permission insuffisante."));
        }
        var txs = jdbc.queryForList(
                "SELECT t.*, p.first_name, p.last_name, pr.reconciled FROM transactions t LEFT JOIN profiles p ON p.user_id = t.user_id LEFT JOIN payment_references pr ON pr.reference = t.payment_reference ORDER BY t.created_at DESC LIMIT 100"
        );
        return ResponseEntity.ok(Map.of("transactions", txs));
    }

    @GetMapping("/audit-logs")
    public ResponseEntity<Map<String, Object>> auditLogs(
            @RequestParam(defaultValue = "120") int limit,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) String targetType,
            @RequestParam(required = false) String actorId,
            Authentication auth
    ) {
        if (!rbacAudit.hasPermission(auth, "ADMIN_VIEW_AUDIT")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Permission insuffisante."));
        }
        return ResponseEntity.ok(Map.of("logs", auditLogService.listLogs(limit, action, targetType, actorId)));
    }

    @GetMapping("/audit-logs/{id}")
    public ResponseEntity<Map<String, Object>> getAuditLog(@PathVariable String id, Authentication auth) {
        if (!rbacAudit.hasPermission(auth, "ADMIN_VIEW_AUDIT")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Permission insuffisante."));
        }
        return auditLogService.getById(id)
                .<ResponseEntity<Map<String, Object>>>map(log -> ResponseEntity.ok(Map.<String, Object>of("log", log)))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Entrée d'audit introuvable.")));
    }

    @GetMapping("/providers")
    public ResponseEntity<Map<String, Object>> providers(Authentication auth) {
        if (!rbacAudit.hasPermission(auth, "ADMIN_VIEW_OVERVIEW")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Permission insuffisante."));
        }
        var providers = jdbc.queryForList("SELECT * FROM provider_configs ORDER BY category, name");
        var errors = jdbc.queryForList("SELECT * FROM integration_errors ORDER BY created_at DESC LIMIT 30");
        return ResponseEntity.ok(Map.of("providers", providers, "errors", errors));
    }

    @PutMapping("/providers/{id}")
    public ResponseEntity<Map<String, Object>> updateProvider(@PathVariable String id, @RequestBody Map<String, Object> body, Authentication auth) {
        if (!rbacAudit.hasPermission(auth, "ADMIN_MANAGE_PROVIDERS")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Permission insuffisante."));
        }
        boolean enabled = Boolean.TRUE.equals(body.get("enabled"));
        String mode = body.get("mode") != null ? String.valueOf(body.get("mode")) : null;
        jdbc.update(
                "UPDATE provider_configs SET enabled = ?, mode = COALESCE(?, mode), updated_by = ?, updated_at = NOW() WHERE id = ?",
                enabled, mode, auth.getName(), id
        );
        rbacAudit.logAudit(auth.getName(), rbacAudit.extractRole(auth), "PROVIDER_CONFIG_UPDATED", "PROVIDER", id, Map.of("enabled", enabled));
        return ResponseEntity.ok(Map.of("provider", jdbc.queryForMap("SELECT * FROM provider_configs WHERE id = ?", id)));
    }

    @PostMapping("/notifications/broadcast")
    @Transactional
    public ResponseEntity<Map<String, Object>> broadcast(@RequestBody Map<String, String> body, Authentication auth) {
        if (!rbacAudit.hasPermission(auth, "ADMIN_SEND_NOTIFICATIONS")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Permission insuffisante."));
        }
        String title = body.getOrDefault("title", "");
        String message = body.getOrDefault("message", "");
        String category = body.getOrDefault("category", "FINANCIAL_TIP");
        List<String> clients = jdbc.queryForList("SELECT id FROM users WHERE role = 'CLIENT' AND status = 'ACTIVE'", String.class);
        for (String cid : clients) {
            jdbc.update(
                    "INSERT INTO notifications (id, user_id, category, title, message, read) VALUES (?, ?, ?, ?, ?, FALSE)",
                    "ntf_" + UUID.randomUUID().toString().substring(0, 10), cid, category, title, message
            );
        }
        rbacAudit.logAudit(auth.getName(), rbacAudit.extractRole(auth), "BROADCAST_NOTIFICATION_SENT", "NOTIFICATION", null, Map.of("recipients", clients.size()));
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("sentCount", clients.size()));
    }
}
