package cd.vmicro.credit.service;

import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

@Service
public class SolvencyService {

    public record Factor(String label, String impact, String status) {}
    public record SolvencyResult(
            int score,
            String riskBand,
            boolean eligible,
            BigDecimal monthlyInstallment,
            BigDecimal disposableIncome,
            BigDecimal debtToIncomeRatio,
            List<Factor> factors,
            String disclaimer
    ) {}

    public record SchedulePreviewItem(
            int installmentNumber,
            BigDecimal principalDue,
            BigDecimal interestDue,
            BigDecimal totalDue
    ) {}

    public record LoanEstimateResult(
            BigDecimal requestedAmount,
            int durationMonths,
            BigDecimal annualInterestRate,
            BigDecimal monthlyInstallment,
            BigDecimal totalInterest,
            BigDecimal totalRepayable,
            List<SchedulePreviewItem> schedulePreview
    ) {}

    public LoanEstimateResult calculateLoanEstimate(BigDecimal requestedAmount, int durationMonths) {
        BigDecimal annualRate = BigDecimal.valueOf(22);
        BigDecimal totalInterest = requestedAmount
                .multiply(BigDecimal.valueOf(0.22))
                .multiply(BigDecimal.valueOf(durationMonths))
                .divide(BigDecimal.valueOf(12), 2, RoundingMode.HALF_UP);
        BigDecimal totalRepayable = requestedAmount.add(totalInterest).setScale(2, RoundingMode.HALF_UP);
        BigDecimal monthlyInstallment = totalRepayable
                .divide(BigDecimal.valueOf(Math.max(1, durationMonths)), 2, RoundingMode.HALF_UP);

        List<SchedulePreviewItem> schedule = new ArrayList<>();
        BigDecimal principalPart = requestedAmount.divide(BigDecimal.valueOf(Math.max(1, durationMonths)), 2, RoundingMode.HALF_UP);
        BigDecimal interestPart = totalInterest.divide(BigDecimal.valueOf(Math.max(1, durationMonths)), 2, RoundingMode.HALF_UP);
        for (int i = 1; i <= durationMonths; i++) {
            schedule.add(new SchedulePreviewItem(
                    i,
                    principalPart,
                    interestPart,
                    principalPart.add(interestPart).setScale(2, RoundingMode.HALF_UP)
            ));
        }
        return new LoanEstimateResult(
                requestedAmount.setScale(2, RoundingMode.HALF_UP),
                durationMonths,
                annualRate,
                monthlyInstallment,
                totalInterest,
                totalRepayable,
                schedule
        );
    }

    public SolvencyResult evaluate(
            int ageYears,
            BigDecimal income,
            BigDecimal expenses,
            BigDecimal commitments,
            BigDecimal requestedAmount,
            int months,
            BigDecimal savingsTotal,
            boolean kycVerified
    ) {
        List<Factor> factors = new ArrayList<>();
        if (ageYears < 18) {
            factors.add(new Factor("Âge inférieur au minimum réglementaire (18 ans)", "Inéligible", "DEFAVORABLE"));
            return new SolvencyResult(0, "INELIGIBLE", false, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.valueOf(100), factors,
                    "Score indicatif uniquement — condition d'âge réglementaire non remplie.");
        }

        LoanEstimateResult est = calculateLoanEstimate(requestedAmount, months);
        BigDecimal monthlyInstallment = est.monthlyInstallment();
        BigDecimal disposable = income.subtract(expenses).subtract(commitments).setScale(2, RoundingMode.HALF_UP);
        BigDecimal dti = income.compareTo(BigDecimal.ZERO) > 0
                ? commitments.add(monthlyInstallment).multiply(BigDecimal.valueOf(100))
                    .divide(income, 2, RoundingMode.HALF_UP)
                : BigDecimal.valueOf(100);

        int score = 35;
        if (disposable.compareTo(monthlyInstallment.multiply(BigDecimal.valueOf(2))) >= 0) {
            score += 22;
            factors.add(new Factor("Capacité nette confortable", "+22 pts", "FAVORABLE"));
        } else if (disposable.compareTo(monthlyInstallment) >= 0) {
            score += 10;
            factors.add(new Factor("Capacité nette modérée", "+10 pts", "ATTENTION"));
        } else {
            score -= 18;
            factors.add(new Factor("Marge nette insuffisante", "-18 pts", "DEFAVORABLE"));
        }

        if (kycVerified) {
            score += 15;
            factors.add(new Factor("Identité KYC vérifiée", "+15 pts", "FAVORABLE"));
        } else {
            factors.add(new Factor("Identité KYC non finalisée", "0 pt", "ATTENTION"));
        }

        if (savingsTotal.compareTo(requestedAmount.multiply(BigDecimal.valueOf(0.2))) >= 0) {
            score += 18;
            factors.add(new Factor("Épargne préalable solide", "+18 pts", "FAVORABLE"));
        }

        int clamped = Math.max(5, Math.min(99, score));
        String band = clamped >= 72 ? "LOW" : (clamped >= 50 ? "MEDIUM" : "HIGH");
        boolean eligible = disposable.compareTo(BigDecimal.ZERO) > 0;

        return new SolvencyResult(clamped, band, eligible, monthlyInstallment, disposable, dti, factors,
                "Score indicatif uniquement — ne constitue pas une garantie d'octroi. Validation humaine requise.");
    }
}
