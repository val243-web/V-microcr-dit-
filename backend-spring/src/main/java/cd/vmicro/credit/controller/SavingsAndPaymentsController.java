package cd.vmicro.credit.controller;

import cd.vmicro.credit.entity.LoanContractEntity;
import cd.vmicro.credit.entity.RepaymentScheduleEntity;
import cd.vmicro.credit.entity.SavingsGoalEntity;
import cd.vmicro.credit.payment.PaymentProvider;
import cd.vmicro.credit.payment.SimulatedMobileMoneyProviders;
import cd.vmicro.credit.security.RbacAndAuditService;
import cd.vmicro.credit.service.LoanContractService;
import cd.vmicro.credit.service.SavingsGoalService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class SavingsAndPaymentsController {

    private final JdbcTemplate jdbc;
    private final SavingsGoalService savingsGoalService;
    private final LoanContractService loanContractService;
    private final SimulatedMobileMoneyProviders paymentProviders;
    private final RbacAndAuditService rbacAudit;

    public SavingsAndPaymentsController(
            JdbcTemplate jdbc,
            SavingsGoalService savingsGoalService,
            LoanContractService loanContractService,
            SimulatedMobileMoneyProviders paymentProviders,
            RbacAndAuditService rbacAudit
    ) {
        this.jdbc = jdbc;
        this.savingsGoalService = savingsGoalService;
        this.loanContractService = loanContractService;
        this.paymentProviders = paymentProviders;
        this.rbacAudit = rbacAudit;
    }

    public record GoalRequest(
            @NotBlank String title,
            @NotBlank String category,
            @NotNull @Positive BigDecimal targetAmount,
            @NotBlank String targetDate
    ) {}

    public record GoalUpdateRequest(
            String title,
            String category,
            BigDecimal targetAmount,
            String targetDate
    ) {}

    public record PaymentInitBody(
            @NotBlank String idempotencyKey,
            @NotBlank String provider,
            @NotBlank String operationType,
            @NotNull @Positive BigDecimal amount,
            String currency,
            String phoneNumber,
            String goalId,
            String loanId
    ) {}

    @GetMapping("/dashboard")
    public Map<String, Object> dashboard(Authentication auth) {
        String userId = auth.getName();
        Map<String, Object> account = new HashMap<>(jdbc.queryForMap(
                "SELECT * FROM savings_accounts WHERE user_id = ?", userId
        ));
        double avail = ((Number) account.get("available_balance")).doubleValue();
        double locked = ((Number) account.get("locked_goals_balance")).doubleValue();
        account.put("total_savings", Math.round((avail + locked) * 100.0) / 100.0);

        List<SavingsGoalEntity> goals = savingsGoalService.listActiveGoals(userId);
        var loans = jdbc.queryForList(
                "SELECT * FROM loan_applications WHERE user_id = ? ORDER BY created_at DESC", userId
        );
        List<LoanContractEntity> activeContracts = loanContractService.listActiveUserContracts(userId);

        List<RepaymentScheduleEntity> nextInstallments = activeContracts.isEmpty()
                ? List.of()
                : loanContractService.getNextPendingSchedules(activeContracts.get(0).getId());

        var recentTransactions = jdbc.queryForList(
                "SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 8", userId
        );
        var recentNotifications = jdbc.queryForList(
                "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5", userId
        );
        var kycRows = jdbc.queryForList(
                "SELECT status, method, provider_reference FROM identity_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
                userId
        );

        return Map.of(
                "simulationNotice", "Paiements Mobile Money en mode simulation — prêts pour branchement API opérateurs.",
                "account", account,
                "goals", goals,
                "loans", loans,
                "activeContracts", activeContracts,
                "nextInstallments", nextInstallments,
                "recentTransactions", recentTransactions,
                "recentNotifications", recentNotifications,
                "kyc", kycRows.isEmpty() ? Map.of("status", "NOT_STARTED") : kycRows.get(0)
        );
    }

    @GetMapping("/savings/goals")
    public Map<String, Object> listGoals(Authentication auth) {
        return Map.of("goals", savingsGoalService.listActiveGoals(auth.getName()));
    }

    @GetMapping("/savings/goals/{id}")
    public Map<String, Object> getGoal(@PathVariable String id, Authentication auth) {
        return Map.of("goal", savingsGoalService.getGoalForUser(id, auth.getName()));
    }

    @PostMapping("/savings/goals")
    public ResponseEntity<Map<String, Object>> createGoal(@Valid @RequestBody GoalRequest req, Authentication auth) {
        SavingsGoalEntity created = savingsGoalService.createGoal(
                auth.getName(), req.title(), req.category(), req.targetAmount(), LocalDate.parse(req.targetDate())
        );
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("goal", created));
    }

    @PutMapping("/savings/goals/{id}")
    public Map<String, Object> updateGoal(@PathVariable String id, @RequestBody GoalUpdateRequest req, Authentication auth) {
        LocalDate parsedDate = req.targetDate() != null && !req.targetDate().isBlank()
                ? LocalDate.parse(req.targetDate())
                : null;
        SavingsGoalEntity updated = savingsGoalService.updateGoal(
                id, auth.getName(), req.title(), req.category(), req.targetAmount(), parsedDate
        );
        return Map.of("goal", updated);
    }

    @DeleteMapping("/savings/goals/{id}")
    public Map<String, Object> deleteGoal(@PathVariable String id, Authentication auth) {
        savingsGoalService.deleteControlledGoal(id, auth.getName(), rbacAudit.extractRole(auth));
        return Map.of("message", "Objectif supprimé.");
    }

    @PostMapping("/savings/goals/{id}/release")
    public Map<String, Object> releaseGoal(@PathVariable String id, Authentication auth) {
        BigDecimal released = savingsGoalService.releaseGoalToAvailableBalance(id, auth.getName(), rbacAudit.extractRole(auth));
        return Map.of("message", released + " USD transférés vers votre épargne libre.");
    }

    @GetMapping("/transactions")
    public Map<String, Object> listTransactions(Authentication auth) {
        var txs = jdbc.queryForList(
                "SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
                auth.getName()
        );
        return Map.of("transactions", txs);
    }

    @GetMapping("/payments/providers")
    public Map<String, Object> listProviders() {
        return Map.of("providers", paymentProviders.listProviders());
    }

    @PostMapping("/payments/initialize")
    @Transactional
    public ResponseEntity<Map<String, Object>> initializePayment(
            @Valid @RequestBody PaymentInitBody body,
            Authentication auth
    ) {
        String userId = auth.getName();
        var existing = jdbc.queryForList(
                "SELECT * FROM payment_references WHERE idempotency_key = ? AND user_id = ?",
                body.idempotencyKey(), userId
        );
        if (!existing.isEmpty()) {
            return ResponseEntity.ok(Map.of("idempotentReplay", true, "payment", existing.get(0)));
        }

        if ("WITHDRAWAL".equals(body.operationType())) {
            BigDecimal avail = jdbc.queryForObject(
                    "SELECT available_balance FROM savings_accounts WHERE user_id = ?",
                    BigDecimal.class, userId
            );
            if (avail == null || avail.compareTo(body.amount()) < 0) {
                return ResponseEntity.badRequest().body(Map.of("error", "Solde disponible insuffisant pour ce retrait."));
            }
        }
        if ("GOAL_DEPOSIT".equals(body.operationType()) && (body.goalId() == null || body.goalId().isBlank())) {
            return ResponseEntity.badRequest().body(Map.of("error", "Identifiant d'objectif requis."));
        }

        PaymentProvider provider = paymentProviders.getProvider(body.provider());
        String reference = "PAY-SIM-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
        String currency = body.currency() != null ? body.currency() : "USD";

        var initRes = provider.initializePayment(new PaymentProvider.PaymentInitRequest(
                reference, body.idempotencyKey(), body.amount(), currency, body.phoneNumber()
        ));

        jdbc.update(
                """
                INSERT INTO payment_references (
                    reference, idempotency_key, user_id, provider, operation_type, amount, currency,
                    phone_number, goal_id, loan_id, external_ref, status, is_simulated, reconciled
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INITIATED', TRUE, FALSE)
                """,
                reference, body.idempotencyKey(), userId, body.provider(), body.operationType(),
                body.amount(), currency, body.phoneNumber(), body.goalId(), body.loanId(), initRes.externalRef()
        );

        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
                "idempotentReplay", false,
                "payment", Map.of(
                        "reference", reference,
                        "externalRef", initRes.externalRef(),
                        "provider", body.provider(),
                        "status", initRes.status(),
                        "amount", body.amount(),
                        "currency", currency,
                        "isSimulated", true,
                        "instructions", initRes.instructions()
                )
        ));
    }

    @PostMapping("/payments/confirm")
    @Transactional
    public ResponseEntity<Map<String, Object>> confirmSimulatedPayment(
            @RequestBody Map<String, Object> body,
            Authentication auth
    ) {
        String reference = String.valueOf(body.getOrDefault("reference", ""));
        boolean simulateFailure = Boolean.TRUE.equals(body.get("simulateFailure"));

        var rows = jdbc.queryForList(
                "SELECT * FROM payment_references WHERE reference = ? AND user_id = ?",
                reference, auth.getName()
        );
        if (rows.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Référence de paiement introuvable."));
        }
        Map<String, Object> payRef = rows.get(0);
        if ("CONFIRMED".equals(payRef.get("status"))) {
            return ResponseEntity.ok(Map.of("reference", reference, "status", "CONFIRMED", "idempotent", true, "isSimulated", true));
        }
        if (simulateFailure) {
            jdbc.update("UPDATE payment_references SET status = 'FAILED', failure_reason = 'Échec simulé', updated_at = NOW() WHERE reference = ?", reference);
            return ResponseEntity.status(HttpStatus.PAYMENT_REQUIRED)
                    .body(Map.of("error", "Échec simulé par opérateur.", "reference", reference, "status", "FAILED"));
        }

        applyConfirmedPayment(payRef);
        return ResponseEntity.ok(Map.of("reference", reference, "status", "CONFIRMED", "isSimulated", true));
    }

    @PostMapping("/payments/cancel/{reference}")
    public ResponseEntity<Map<String, Object>> cancelPayment(@PathVariable String reference, Authentication auth) {
        var rows = jdbc.queryForList(
                "SELECT reference, provider, external_ref, status FROM payment_references WHERE reference = ? AND user_id = ?",
                reference, auth.getName()
        );
        if (rows.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Paiement introuvable."));
        }
        if ("CONFIRMED".equals(rows.get(0).get("status"))) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "Impossible d'annuler un paiement confirmé."));
        }
        jdbc.update("UPDATE payment_references SET status = 'CANCELLED', updated_at = NOW() WHERE reference = ?", reference);
        return ResponseEntity.ok(Map.of("reference", reference, "status", "CANCELLED"));
    }

    @PostMapping("/payments/webhook/{providerId}")
    @Transactional
    public ResponseEntity<Map<String, Object>> webhook(
            @PathVariable String providerId,
            @RequestHeader(value = "x-vmicro-signature", required = false) String signature,
            @RequestBody String rawBody
    ) {
        PaymentProvider provider = paymentProviders.getProvider(providerId.toUpperCase());
        if (!provider.verifyWebhookSignature(rawBody, signature)) {
            jdbc.update(
                    "INSERT INTO integration_errors (id, provider, endpoint, error_code, message, resolved) VALUES (?, ?, ?, 'INVALID_WEBHOOK_SIGNATURE', 'Signature HMAC invalide reçue sur webhook.', FALSE)",
                    "err_" + UUID.randomUUID().toString().substring(0, 10),
                    providerId.toUpperCase(),
                    "/api/v1/payments/webhook/" + providerId
            );
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Signature webhook invalide."));
        }
        try {
            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            var node = mapper.readTree(rawBody);
            String reference = node.path("reference").asText("");
            String status = node.path("status").asText("");
            var rows = jdbc.queryForList("SELECT * FROM payment_references WHERE reference = ?", reference);
            if (rows.isEmpty()) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Référence inconnue."));
            }
            Map<String, Object> payRef = rows.get(0);
            if ("CONFIRMED".equals(payRef.get("status"))) {
                return ResponseEntity.ok(Map.of("received", true, "duplicateIgnored", true, "status", "CONFIRMED"));
            }
            if ("CONFIRMED".equals(status)) {
                applyConfirmedPayment(payRef);
            } else {
                jdbc.update("UPDATE payment_references SET status = 'FAILED', failure_reason = 'Échec webhook', updated_at = NOW() WHERE reference = ?", reference);
            }
            return ResponseEntity.ok(Map.of("received", true, "duplicateIgnored", false, "status", status));
        } catch (Exception ex) {
            return ResponseEntity.badRequest().body(Map.of("error", "Payload webhook invalide."));
        }
    }

    private void applyConfirmedPayment(Map<String, Object> payRef) {
        String reference = String.valueOf(payRef.get("reference"));
        String userId = String.valueOf(payRef.get("user_id"));
        String provider = String.valueOf(payRef.get("provider"));
        String opType = String.valueOf(payRef.get("operation_type"));
        BigDecimal amount = (BigDecimal) payRef.get("amount");
        String currency = String.valueOf(payRef.get("currency"));
        String goalId = payRef.get("goal_id") != null ? String.valueOf(payRef.get("goal_id")) : null;
        String loanId = payRef.get("loan_id") != null ? String.valueOf(payRef.get("loan_id")) : null;

        jdbc.update("UPDATE payment_references SET status = 'CONFIRMED', reconciled = TRUE, updated_at = NOW() WHERE reference = ?", reference);

        String txType = "DEPOSIT";
        String desc = "Dépôt Mobile Money " + provider + " (Simulation)";

        if ("DEPOSIT".equals(opType)) {
            jdbc.update("UPDATE savings_accounts SET available_balance = available_balance + ?, updated_at = NOW() WHERE user_id = ?", amount, userId);
        } else if ("GOAL_DEPOSIT".equals(opType) && goalId != null) {
            txType = "GOAL_ALLOCATION";
            desc = "Dépôt objectif d'épargne via " + provider + " (Simulation)";
            jdbc.update("UPDATE savings_goals SET current_amount = current_amount + ?, updated_at = NOW() WHERE id = ? AND user_id = ?", amount, goalId, userId);
            jdbc.update("UPDATE savings_accounts SET locked_goals_balance = locked_goals_balance + ?, updated_at = NOW() WHERE user_id = ?", amount, userId);
        } else if ("WITHDRAWAL".equals(opType)) {
            txType = "WITHDRAWAL";
            desc = "Retrait vers " + provider + " (Simulation)";
            BigDecimal avail = jdbc.queryForObject("SELECT available_balance FROM savings_accounts WHERE user_id = ?", BigDecimal.class, userId);
            if (avail == null || avail.compareTo(amount) < 0) {
                throw new IllegalArgumentException("Solde insuffisant lors de la confirmation.");
            }
            jdbc.update("UPDATE savings_accounts SET available_balance = available_balance - ?, updated_at = NOW() WHERE user_id = ?", amount, userId);
        }

        jdbc.update(
                "INSERT INTO transactions (id, user_id, goal_id, loan_id, payment_reference, type, amount, currency, provider, status, description, is_simulated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, TRUE)",
                "tx_" + UUID.randomUUID().toString().substring(0, 10), userId, goalId, loanId, reference, txType, amount, currency, provider, desc
        );
        jdbc.update(
                "INSERT INTO notifications (id, user_id, category, title, message, read) VALUES (?, ?, ?, ?, ?, FALSE)",
                "ntf_" + UUID.randomUUID().toString().substring(0, 10),
                userId,
                "WITHDRAWAL".equals(opType) ? "WITHDRAWAL_CONFIRMED" : "DEPOSIT_CONFIRMED",
                "WITHDRAWAL".equals(opType) ? "Retrait confirmé (Simulation)" : "Dépôt confirmé (Simulation)",
                desc + " — " + amount + " " + currency
        );
    }
}
