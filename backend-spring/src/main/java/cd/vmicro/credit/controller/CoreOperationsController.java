package cd.vmicro.credit.controller;

import cd.vmicro.credit.halisi.HalisiProviders;
import cd.vmicro.credit.payment.PaymentProvider;
import cd.vmicro.credit.payment.SimulatedMobileMoneyProviders;
import cd.vmicro.credit.service.SolvencyService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
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
import java.sql.Date;
import java.time.LocalDate;
import java.time.Period;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
public class CoreOperationsController {

    private final JdbcTemplate jdbc;
    private final SolvencyService solvencyService;
    private final SimulatedMobileMoneyProviders paymentProviders;
    private final HalisiProviders.HalisiIdentityVerificationProvider halisiIdentity;
    private final HalisiProviders.HalisiCreditAssessmentProvider halisiCredit;

    public CoreOperationsController(
            JdbcTemplate jdbc,
            SolvencyService solvencyService,
            SimulatedMobileMoneyProviders paymentProviders,
            HalisiProviders.HalisiIdentityVerificationProvider halisiIdentity,
            HalisiProviders.HalisiCreditAssessmentProvider halisiCredit
    ) {
        this.jdbc = jdbc;
        this.solvencyService = solvencyService;
        this.paymentProviders = paymentProviders;
        this.halisiIdentity = halisiIdentity;
        this.halisiCredit = halisiCredit;
    }

    public record LoanEstimateRequest(
            @NotNull @Positive BigDecimal requestedAmount,
            @Min(1) @Max(24) int durationMonths
    ) {}

    public record LoanApplyRequest(
            @NotBlank String businessActivity,
            @Min(0) int businessYears,
            @NotNull @Positive BigDecimal monthlyIncome,
            @NotNull @Min(0) BigDecimal monthlyExpenses,
            BigDecimal existingCommitments,
            @NotNull @Positive BigDecimal requestedAmount,
            @Min(1) @Max(24) int durationMonths,
            @NotBlank String purpose
    ) {}

    public record PaymentInitBody(
            @NotBlank String idempotencyKey,
            @NotBlank String provider,
            @NotBlank String operationType,
            @NotNull @Positive BigDecimal amount,
            String currency,
            String phoneNumber
    ) {}

    @PostMapping("/loans/estimate")
    public SolvencyService.SolvencyResult estimateLoan(@Valid @RequestBody LoanEstimateRequest req) {
        return solvencyService.evaluate(
                25,
                BigDecimal.valueOf(500),
                BigDecimal.valueOf(200),
                BigDecimal.ZERO,
                req.requestedAmount(),
                req.durationMonths(),
                BigDecimal.ZERO,
                true
        );
    }

    @PostMapping("/loans/apply")
    @Transactional
    public ResponseEntity<Map<String, Object>> applyLoan(
            Authentication auth,
            @Valid @RequestBody LoanApplyRequest req
    ) {
        String userId = auth.getName();
        Date dob = jdbc.queryForObject("SELECT date_of_birth FROM profiles WHERE user_id = ?", Date.class, userId);
        int age = dob != null ? Period.between(dob.toLocalDate(), LocalDate.now()).getYears() : 0;

        BigDecimal totalSavings = jdbc.queryForObject(
                "SELECT COALESCE(available_balance + locked_goals_balance, 0) FROM savings_accounts WHERE user_id = ?",
                BigDecimal.class,
                userId
        );
        Integer verifiedCount = jdbc.queryForObject(
                "SELECT COUNT(*) FROM identity_verifications WHERE user_id = ? AND status = 'VERIFIED'",
                Integer.class,
                userId
        );
        boolean kycVerified = verifiedCount != null && verifiedCount > 0;

        BigDecimal commitments = req.existingCommitments() != null ? req.existingCommitments() : BigDecimal.ZERO;
        var solvency = solvencyService.evaluate(
                age,
                req.monthlyIncome(),
                req.monthlyExpenses(),
                commitments,
                req.requestedAmount(),
                req.durationMonths(),
                totalSavings != null ? totalSavings : BigDecimal.ZERO,
                kycVerified
        );

        if ("INELIGIBLE".equals(solvency.riskBand())) {
            return ResponseEntity.unprocessableEntity().body(Map.of(
                    "error", "Conditions réglementaires d'éligibilité non remplies.",
                    "solvency", solvency
            ));
        }

        var halisiRes = halisiCredit.assessCredit(new HalisiProviders.CreditAssessmentRequest(
                userId,
                req.requestedAmount().doubleValue(),
                req.durationMonths(),
                req.monthlyIncome().doubleValue(),
                req.monthlyExpenses().doubleValue(),
                totalSavings != null ? totalSavings.doubleValue() : 0.0,
                kycVerified
        ));

        String loanId = "loan_" + UUID.randomUUID().toString().substring(0, 10);
        jdbc.update(
                """
                INSERT INTO loan_applications (
                    id, user_id, business_activity, business_years, monthly_income, monthly_expenses,
                    existing_commitments, requested_amount, duration_months, purpose, estimated_monthly_payment, status, is_simulated
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW', TRUE)
                """,
                loanId, userId, req.businessActivity(), req.businessYears(), req.monthlyIncome(),
                req.monthlyExpenses(), commitments, req.requestedAmount(), req.durationMonths(),
                req.purpose(), solvency.monthlyInstallment()
        );

        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
                "loanId", loanId,
                "status", "PENDING_REVIEW",
                "solvency", solvency,
                "halisiAssessment", halisiRes
        ));
    }

    @GetMapping("/payments/providers")
    public Map<String, Object> listProviders() {
        return Map.of("providers", paymentProviders.listProviders());
    }

    @PostMapping("/payments/initialize")
    @Transactional
    public ResponseEntity<Map<String, Object>> initializePayment(
            Authentication auth,
            @Valid @RequestBody PaymentInitBody body
    ) {
        String userId = auth.getName();
        var existing = jdbc.queryForList(
                "SELECT reference, provider, status, amount, currency FROM payment_references WHERE idempotency_key = ?",
                body.idempotencyKey()
        );
        if (!existing.isEmpty()) {
            return ResponseEntity.ok(Map.of("idempotentReplay", true, "payment", existing.get(0)));
        }

        PaymentProvider provider = paymentProviders.getProvider(body.provider());
        String reference = "PAY-" + UUID.randomUUID().toString().substring(0, 10).toUpperCase();
        var initRes = provider.initializePayment(new PaymentProvider.PaymentInitRequest(
                reference,
                body.idempotencyKey(),
                body.amount(),
                body.currency() != null ? body.currency() : "USD",
                body.phoneNumber()
        ));

        jdbc.update(
                """
                INSERT INTO payment_references (
                    reference, idempotency_key, user_id, provider, operation_type, amount, currency, phone_number, external_ref, status, is_simulated
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'INITIATED', TRUE)
                """,
                reference, body.idempotencyKey(), userId, body.provider(), body.operationType(),
                body.amount(), body.currency() != null ? body.currency() : "USD",
                body.phoneNumber(), initRes.externalRef()
        );

        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
                "idempotentReplay", false,
                "payment", initRes
        ));
    }

    @PostMapping("/payments/webhook/{providerId}")
    public ResponseEntity<Map<String, Object>> paymentWebhook(
            @PathVariable String providerId,
            @RequestHeader(value = "x-vmicro-signature", required = false) String signature,
            @RequestBody String rawBody
    ) {
        PaymentProvider provider = paymentProviders.getProvider(providerId);
        if (!provider.verifyWebhookSignature(rawBody, signature)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Signature HMAC webhook invalide."));
        }
        return ResponseEntity.ok(Map.of("verified", true, "provider", providerId));
    }

    @PostMapping("/kyc/verify-biometric")
    public ResponseEntity<HalisiProviders.IdentityCheckResult> verifyKyc(
            Authentication auth,
            @RequestBody Map<String, Boolean> body
    ) {
        String userId = auth.getName();
        List<Boolean> consentRows = jdbc.queryForList(
                "SELECT granted FROM consents WHERE user_id = ? AND consent_type = 'BIOMETRIC_VERIFICATION' ORDER BY granted_at DESC LIMIT 1",
                Boolean.class,
                userId
        );
        if (consentRows.isEmpty() || !Boolean.TRUE.equals(consentRows.get(0))) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        var result = halisiIdentity.verifyIdentity(new HalisiProviders.IdentityCheckRequest(
                userId,
                true,
                Boolean.TRUE.equals(body.get("livenessCompleted")),
                Boolean.TRUE.equals(body.get("documentProvided"))
        ));
        return ResponseEntity.ok(result);
    }
}
