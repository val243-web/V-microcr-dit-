package cd.vmicro.credit.halisi;

import org.springframework.stereotype.Service;
import java.util.UUID;

@Service
public class MockHalisiProviders implements
        HalisiProviders.HalisiEnrollmentProvider,
        HalisiProviders.HalisiIdentityVerificationProvider,
        HalisiProviders.HalisiCreditAssessmentProvider {

    @Override
    public HalisiProviders.EnrollmentResult enrollClient(HalisiProviders.EnrollmentRequest request) {
        String ref = "HAL-SIM-ENR-" + UUID.randomUUID().toString().substring(0, 6).toUpperCase();
        return new HalisiProviders.EnrollmentResult(ref, true, true);
    }

    @Override
    public HalisiProviders.IdentityCheckResult verifyIdentity(HalisiProviders.IdentityCheckRequest request) {
        String ref = "HAL-SIM-KYC-" + UUID.randomUUID().toString().substring(0, 6).toUpperCase();
        boolean ok = request.consentGranted() && request.livenessPassed() && request.documentProvided();
        return new HalisiProviders.IdentityCheckResult(
                ref,
                ok ? "VERIFIED" : "FAILED",
                request.livenessPassed(),
                request.documentProvided(),
                true
        );
    }

    @Override
    public HalisiProviders.CreditAssessmentResult assessCredit(HalisiProviders.CreditAssessmentRequest request) {
        String ref = "HAL-SIM-CRD-" + UUID.randomUUID().toString().substring(0, 6).toUpperCase();
        String band = request.kycVerified() && request.monthlyIncome() > request.monthlyExpenses()
                ? "MODERATE_ACCEPTABLE"
                : "REVIEW_REQUIRED";
        return new HalisiProviders.CreditAssessmentResult(
                ref,
                band,
                "Signal indicatif Halisi Mock — validation humaine obligatoire.",
                true
        );
    }
}
