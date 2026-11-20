package cd.vmicro.credit.controller;

import cd.vmicro.credit.entity.LoanContractEntity;
import cd.vmicro.credit.entity.RepaymentScheduleEntity;
import cd.vmicro.credit.halisi.HalisiProviders;
import cd.vmicro.credit.security.RbacAndAuditService;
import cd.vmicro.credit.service.GeminiRestService;
import cd.vmicro.credit.service.LoanContractService;
import cd.vmicro.credit.service.SolvencyService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
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
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class LoansAndKycController {

    private final JdbcTemplate jdbc;
    private final SolvencyService solvencyService;
    private final LoanContractService loanContractService;
    private final HalisiProviders.HalisiEnrollmentProvider halisiEnrollment;
    private final HalisiProviders.HalisiIdentityVerificationProvider halisiIdentity;
    private final HalisiProviders.HalisiCreditAssessmentProvider halisiCredit;
    private final GeminiRestService geminiRestService;
    private final RbacAndAuditService rbacAudit;
    private final ObjectMapper objectMapper;

    public LoansAndKycController(
            JdbcTemplate jdbc,
            SolvencyService solvencyService,
            LoanContractService loanContractService,
            HalisiProviders.HalisiEnrollmentProvider halisiEnrollment,
            HalisiProviders.HalisiIdentityVerificationProvider halisiIdentity,
            HalisiProviders.HalisiCreditAssessmentProvider halisiCredit,
            GeminiRestService geminiRestService,
            RbacAndAuditService rbacAudit,
            ObjectMapper objectMapper
    ) {
        this.jdbc = jdbc;
        this.solvencyService = solvencyService;
        this.loanContractService = loanContractService;
        this.halisiEnrollment = halisiEnrollment;
        this.halisiIdentity = halisiIdentity;
        this.halisiCredit = halisiCredit;
        this.geminiRestService = geminiRestService;
        this.rbacAudit = rbacAudit;
        this.objectMapper = objectMapper;
    }

    public record LoanEstimateBody(@NotNull @Positive BigDecimal requestedAmount, @Min(1) @Max(24) int durationMonths) {}
    public record LoanApplyBody(
            @NotBlank String businessActivity,
            @Min(0) int businessYears,
            @NotNull @Positive BigDecimal monthlyIncome,
            @NotNull @Min(0) BigDecimal monthlyExpenses,
            BigDecimal existingCommitments,
            @NotNull @Positive BigDecimal requestedAmount,
            @Min(1) @Max(24) int durationMonths,
            @NotBlank String purpose
    ) {}
    public record RepayBody(@NotBlank String scheduleId, @NotBlank String provider, @NotBlank String idempotencyKey) {}
    public record FaceDocBody(@NotBlank String selfieBase64, String selfieMimeType, String documentBase64, String documentMimeType) {}
    public record VoiceBody(@NotBlank String audioBase64, String audioMimeType, @NotBlank String expectedPhrase) {}

    @PostMapping("/loans/estimate")
    public SolvencyService.LoanEstimateResult estimate(@Valid @RequestBody LoanEstimateBody req) {
        return solvencyService.calculateLoanEstimate(req.requestedAmount(), req.durationMonths());
    }

    @GetMapping("/loans")
    public Map<String, Object> listLoans(Authentication auth) {
        String userId = auth.getName();
        var applications = jdbc.queryForList(
                """
                SELECT la.*, sa.score, sa.risk_band, sa.eligible, sa.debt_to_income_ratio, sa.disposable_income, sa.factors_json, sa.disclaimer
                FROM loan_applications la
                LEFT JOIN solvency_assessments sa ON sa.loan_application_id = la.id
                WHERE la.user_id = ?
                ORDER BY la.created_at DESC
                """,
                userId
        );
        List<LoanContractEntity> contracts = loanContractService.listUserContracts(userId);
        return Map.of("applications", applications, "contracts", contracts);
    }

    @GetMapping("/loans/{id}")
    public ResponseEntity<Map<String, Object>> getLoanDetail(@PathVariable String id, Authentication auth) {
        var rows = jdbc.queryForList(
                """
                SELECT la.*, sa.score, sa.risk_band, sa.eligible, sa.debt_to_income_ratio, sa.disposable_income, sa.factors_json, sa.disclaimer, sa.halisi_reference
                FROM loan_applications la
                LEFT JOIN solvency_assessments sa ON sa.loan_application_id = la.id
                WHERE la.id = ? AND la.user_id = ?
                """,
                id, auth.getName()
        );
        if (rows.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Demande de crédit introuvable."));
        }
        Optional<LoanContractEntity> contractOpt = loanContractService.findByApplicationId(id);
        LoanContractEntity contract = contractOpt.orElse(null);
        List<RepaymentScheduleEntity> schedule = contract != null ? loanContractService.getSchedules(contract.getId()) : List.of();
        List<Map<String, Object>> repayments = contract != null
                ? jdbc.queryForList("SELECT * FROM repayments WHERE contract_id = ? ORDER BY created_at DESC", contract.getId())
                : List.of();

        Map<String, Object> result = new HashMap<>();
        result.put("application", rows.get(0));
        result.put("contract", contract);
        result.put("schedule", schedule);
        result.put("repayments", repayments);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/loan-contracts")
    public Map<String, Object> listMyContracts(Authentication auth) {
        return Map.of("contracts", loanContractService.listUserContracts(auth.getName()));
    }

    @GetMapping("/loan-contracts/{id}")
    public Map<String, Object> getMyContract(@PathVariable String id, Authentication auth) {
        LoanContractEntity contract = loanContractService.getContractForUser(id, auth.getName());
        List<RepaymentScheduleEntity> schedule = loanContractService.getSchedules(contract.getId());
        return Map.of("contract", contract, "schedule", schedule);
    }

    @PostMapping("/loans/apply")
    @Transactional
    public ResponseEntity<Map<String, Object>> applyLoan(@Valid @RequestBody LoanApplyBody req, Authentication auth) throws Exception {
        String userId = auth.getName();
        Date dob = jdbc.queryForObject("SELECT date_of_birth FROM profiles WHERE user_id = ?", Date.class, userId);
        int age = dob != null ? Period.between(dob.toLocalDate(), LocalDate.now()).getYears() : 0;
        BigDecimal totalSavings = jdbc.queryForObject(
                "SELECT COALESCE(available_balance + locked_goals_balance, 0) FROM savings_accounts WHERE user_id = ?",
                BigDecimal.class, userId
        );
        Integer verifiedCount = jdbc.queryForObject(
                "SELECT COUNT(*) FROM identity_verifications WHERE user_id = ? AND status = 'VERIFIED'",
                Integer.class, userId
        );
        boolean kycVerified = verifiedCount != null && verifiedCount > 0;
        BigDecimal commitments = req.existingCommitments() != null ? req.existingCommitments() : BigDecimal.ZERO;

        var solvency = solvencyService.evaluate(
                age, req.monthlyIncome(), req.monthlyExpenses(), commitments,
                req.requestedAmount(), req.durationMonths(),
                totalSavings != null ? totalSavings : BigDecimal.ZERO, kycVerified
        );

        if ("INELIGIBLE".equals(solvency.riskBand())) {
            return ResponseEntity.unprocessableEntity().body(Map.of(
                    "error", "Conditions réglementaires d'éligibilité non remplies.",
                    "solvency", solvency
            ));
        }

        var halisiRes = halisiCredit.assessCredit(new HalisiProviders.CreditAssessmentRequest(
                userId, req.requestedAmount().doubleValue(), req.durationMonths(),
                req.monthlyIncome().doubleValue(), req.monthlyExpenses().doubleValue(),
                totalSavings != null ? totalSavings.doubleValue() : 0.0, kycVerified
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
        jdbc.update(
                """
                INSERT INTO solvency_assessments (
                    id, loan_application_id, user_id, score, risk_band, debt_to_income_ratio,
                    disposable_income, eligible, factors_json, halisi_reference, disclaimer
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?)
                """,
                "solv_" + UUID.randomUUID().toString().substring(0, 10),
                loanId, userId, solvency.score(), solvency.riskBand(), solvency.debtToIncomeRatio(),
                solvency.disposableIncome(), solvency.eligible(),
                objectMapper.writeValueAsString(solvency.factors()),
                halisiRes.assessmentRef(), solvency.disclaimer()
        );
        jdbc.update(
                "INSERT INTO notifications (id, user_id, category, title, message, read) VALUES (?, ?, 'LOAN_RECEIVED', 'Demande de crédit reçue', ?, FALSE)",
                "ntf_" + UUID.randomUUID().toString().substring(0, 10),
                userId,
                "Votre demande de " + req.requestedAmount() + " USD sur " + req.durationMonths() + " mois est en cours d'examen."
        );
        rbacAudit.logAudit(userId, rbacAudit.extractRole(auth), "LOAN_APPLICATION_SUBMITTED", "LOAN_APPLICATION", loanId,
                Map.of("amount", req.requestedAmount(), "score", solvency.score()));

        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
                "loanId", loanId,
                "status", "PENDING_REVIEW",
                "solvency", solvency,
                "halisiAssessment", halisiRes
        ));
    }

    @PostMapping("/loans/{id}/repay")
    public Map<String, Object> repayInstallment(
            @PathVariable String id,
            @Valid @RequestBody RepayBody body,
            Authentication auth
    ) {
        return loanContractService.recordInstallmentPayment(
                id, auth.getName(), body.scheduleId(), body.provider(), body.idempotencyKey()
        );
    }

    @GetMapping("/kyc/status")
    public Map<String, Object> kycStatus(Authentication auth) {
        var verif = jdbc.queryForList("SELECT * FROM identity_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1", auth.getName());
        var consent = jdbc.queryForList("SELECT * FROM consents WHERE user_id = ? AND consent_type = 'BIOMETRIC_VERIFICATION' ORDER BY granted_at DESC LIMIT 1", auth.getName());
        Map<String, Object> out = new HashMap<>();
        out.put("verification", verif.isEmpty() ? null : verif.get(0));
        out.put("biometricConsent", consent.isEmpty() ? null : consent.get(0));
        return out;
    }

    @PostMapping("/kyc/consent")
    public Map<String, Object> kycConsent(@RequestBody Map<String, Boolean> body, Authentication auth, HttpServletRequest req) {
        boolean granted = Boolean.TRUE.equals(body.get("granted"));
        String id = "cns_" + UUID.randomUUID().toString().substring(0, 10);
        jdbc.update(
                "INSERT INTO consents (id, user_id, consent_type, granted, version, ip_address, granted_at, revoked_at) VALUES (?, ?, 'BIOMETRIC_VERIFICATION', ?, '1.0', ?, NOW(), ?)",
                id, auth.getName(), granted, req.getRemoteAddr(), granted ? null : java.sql.Timestamp.from(java.time.Instant.now())
        );
        rbacAudit.logAudit(auth.getName(), rbacAudit.extractRole(auth),
                granted ? "BIOMETRIC_CONSENT_GRANTED" : "BIOMETRIC_CONSENT_REVOKED", "CONSENT", id, Map.of());
        return Map.of("id", id, "granted", granted);
    }

    @PostMapping("/kyc/verify-biometric")
    public ResponseEntity<Map<String, Object>> verifyBiometric(@RequestBody Map<String, Object> body, Authentication auth) {
        String userId = auth.getName();
        if (!hasBiometricConsent(userId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Le consentement biométrique explicite est requis."));
        }
        boolean liveness = Boolean.TRUE.equals(body.get("livenessCompleted"));
        boolean doc = Boolean.TRUE.equals(body.get("documentProvided"));
        boolean deviceBio = Boolean.TRUE.equals(body.get("deviceBiometricUsed"));

        var prof = jdbc.queryForMap("SELECT first_name, last_name, city FROM profiles WHERE user_id = ?", userId);
        String phone = jdbc.queryForObject("SELECT phone FROM users WHERE id = ?", String.class, userId);

        halisiEnrollment.enrollClient(new HalisiProviders.EnrollmentRequest(
                userId, String.valueOf(prof.get("first_name")), String.valueOf(prof.get("last_name")),
                phone, String.valueOf(prof.get("city")), "BIOMETRIC_VERIFICATION"
        ));
        var res = halisiIdentity.verifyIdentity(new HalisiProviders.IdentityCheckRequest(userId, true, liveness, doc));
        String kycId = "kyc_" + UUID.randomUUID().toString().substring(0, 10);
        jdbc.update(
                "INSERT INTO identity_verifications (id, user_id, method, provider, provider_reference, liveness_passed, document_matched, device_biometric_verified, status, is_simulated) VALUES (?, ?, 'HALISI_FACE_LIVENESS', 'HalisiMockProvider', ?, ?, ?, ?, ?, TRUE)",
                kycId, userId, res.verificationRef(), res.livenessPassed(), res.documentMatched(), deviceBio, res.status()
        );
        return ResponseEntity.ok(Map.of(
                "id", kycId, "providerName", "HalisiMockProvider", "verificationRef", res.verificationRef(),
                "status", res.status(), "livenessPassed", res.livenessPassed(),
                "documentMatched", res.documentMatched(), "isSimulated", true
        ));
    }

    @PostMapping("/kyc/alternative")
    public ResponseEntity<Map<String, Object>> kycAlternative(@RequestBody Map<String, String> body, Authentication auth) {
        String docType = body.getOrDefault("documentType", "CARTE_ELECTEUR_RDC");
        String last4 = body.getOrDefault("documentLast4", "");
        String reason = body.getOrDefault("reason", "");
        if (last4.length() < 4 || reason.length() < 5) {
            return ResponseEntity.badRequest().body(Map.of("error", "Informations de pièce justificative incomplètes."));
        }
        String id = "kyc_" + UUID.randomUUID().toString().substring(0, 10);
        String ref = "ALT-KYC-" + UUID.randomUUID().toString().substring(0, 6).toUpperCase();
        jdbc.update(
                "INSERT INTO identity_verifications (id, user_id, method, provider, provider_reference, liveness_passed, document_matched, device_biometric_verified, status, failure_reason, is_simulated) VALUES (?, ?, 'ALTERNATIVE_AGENT_KYC', 'ManualVerificationQueue', ?, FALSE, FALSE, FALSE, 'PENDING_REVIEW', ?, TRUE)",
                id, auth.getName(), ref, docType + " (***" + last4 + ") — " + reason
        );
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
                "id", id, "status", "PENDING_REVIEW", "providerReference", ref,
                "message", "Demande de vérification manuelle envoyée à un agent autorisé."
        ));
    }

    @PostMapping("/kyc/gemini-verify-face-doc")
    public ResponseEntity<Object> geminiFaceDoc(@Valid @RequestBody FaceDocBody body, Authentication auth) {
        if (!hasBiometricConsent(auth.getName())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Le consentement biométrique explicite est requis."));
        }
        var result = geminiRestService.verifyFaceAndDocument(body.selfieBase64(), body.selfieMimeType(), body.documentBase64(), body.documentMimeType());
        String kycId = "kyc_" + UUID.randomUUID().toString().substring(0, 10);
        String status = result.passed() ? "VERIFIED" : "FAILED";
        jdbc.update(
                "INSERT INTO identity_verifications (id, user_id, method, provider, provider_reference, liveness_passed, document_matched, device_biometric_verified, status, failure_reason, is_simulated) VALUES (?, ?, 'GEMINI_MULTIMODAL_FACE_TEST', 'GeminiVisionTest', ?, ?, ?, FALSE, ?, ?, TRUE)",
                kycId, auth.getName(), result.verificationRef(), result.livenessLikely(), result.documentReadable(), status, result.passed() ? null : result.observations()
        );
        return ResponseEntity.ok(Map.ofEntries(
                Map.entry("id", kycId),
                Map.entry("status", status),
                Map.entry("verificationRef", result.verificationRef()),
                Map.entry("livenessLikely", result.livenessLikely()),
                Map.entry("faceClear", result.faceClear()),
                Map.entry("documentReadable", result.documentReadable()),
                Map.entry("documentTypeDetected", result.documentTypeDetected()),
                Map.entry("passed", result.passed()),
                Map.entry("observations", result.observations()),
                Map.entry("isSimulatedEvaluation", true),
                Map.entry("disclaimer", result.disclaimer())
        ));
    }

    @PostMapping("/kyc/gemini-verify-voice")
    public ResponseEntity<Object> geminiVoice(@Valid @RequestBody VoiceBody body, Authentication auth) {
        if (!hasBiometricConsent(auth.getName())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Le consentement biométrique explicite est requis."));
        }
        var result = geminiRestService.verifyVoiceChallenge(body.audioBase64(), body.audioMimeType(), body.expectedPhrase());
        String kycId = "kyc_" + UUID.randomUUID().toString().substring(0, 10);
        String status = result.passed() ? "VERIFIED" : "FAILED";
        jdbc.update(
                "INSERT INTO identity_verifications (id, user_id, method, provider, provider_reference, liveness_passed, document_matched, device_biometric_verified, status, failure_reason, is_simulated) VALUES (?, ?, 'GEMINI_VOICE_CHALLENGE_TEST', 'GeminiAudioTranscribeTest', ?, ?, FALSE, FALSE, ?, ?, TRUE)",
                kycId, auth.getName(), result.verificationRef(), result.passed(), status,
                result.passed() ? null : "Correspondance vocale insuffisante"
        );
        return ResponseEntity.ok(Map.of(
                "id", kycId, "status", status, "verificationRef", result.verificationRef(),
                "transcript", result.transcript(), "expectedPhrase", result.expectedPhrase(),
                "similarityScore", result.similarityScore(), "passed", result.passed(), "isSimulatedEvaluation", true
        ));
    }

    private boolean hasBiometricConsent(String userId) {
        List<Boolean> rows = jdbc.queryForList(
                "SELECT granted FROM consents WHERE user_id = ? AND consent_type = 'BIOMETRIC_VERIFICATION' ORDER BY granted_at DESC LIMIT 1",
                Boolean.class, userId
        );
        return !rows.isEmpty() && Boolean.TRUE.equals(rows.get(0));
    }
}
