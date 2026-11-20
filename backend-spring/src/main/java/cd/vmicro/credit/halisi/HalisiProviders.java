package cd.vmicro.credit.halisi;

public final class HalisiProviders {
    private HalisiProviders() {}

    public interface HalisiEnrollmentProvider {
        EnrollmentResult enrollClient(EnrollmentRequest request);
    }

    public interface HalisiIdentityVerificationProvider {
        IdentityCheckResult verifyIdentity(IdentityCheckRequest request);
    }

    public interface HalisiCreditAssessmentProvider {
        CreditAssessmentResult assessCredit(CreditAssessmentRequest request);
    }

    public record EnrollmentRequest(String userId, String firstName, String lastName, String phone, String city, String consentRef) {}
    public record EnrollmentResult(String halisiClientRef, boolean enrolled, boolean simulated) {}
    public record IdentityCheckRequest(String userId, boolean consentGranted, boolean livenessPassed, boolean documentProvided) {}
    public record IdentityCheckResult(String verificationRef, String status, boolean livenessPassed, boolean documentMatched, boolean simulated) {}
    public record CreditAssessmentRequest(String userId, double requestedAmount, int durationMonths, double monthlyIncome, double monthlyExpenses, double savingsTotal, boolean kycVerified) {}
    public record CreditAssessmentResult(String assessmentRef, String externalRiskSignal, String note, boolean simulated) {}
}
