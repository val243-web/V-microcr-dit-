package cd.vmicro.credit.entity;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.OffsetDateTime;

@Entity
@Table(name = "loan_contracts")
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LoanContractEntity {

    @Id
    @Column(length = 64, nullable = false)
    private String id;

    @Column(name = "loan_application_id", length = 64, nullable = false, unique = true)
    private String loanApplicationId;

    @Column(name = "user_id", length = 64, nullable = false)
    private String userId;

    @Column(name = "principal_amount", precision = 14, scale = 2, nullable = false)
    private BigDecimal principalAmount;

    @Column(name = "annual_interest_rate", precision = 5, scale = 2, nullable = false)
    private BigDecimal annualInterestRate;

    @Column(name = "duration_months", nullable = false)
    private Integer durationMonths;

    @Column(name = "monthly_installment", precision = 14, scale = 2, nullable = false)
    private BigDecimal monthlyInstallment;

    @Column(name = "total_repayable", precision = 14, scale = 2, nullable = false)
    private BigDecimal totalRepayable;

    @Column(name = "remaining_balance", precision = 14, scale = 2, nullable = false)
    private BigDecimal remainingBalance;

    @Column(length = 24, nullable = false)
    private String status = "ACTIVE";

    @Column(name = "disbursed_at", nullable = false)
    private OffsetDateTime disbursedAt;

    @Column(name = "is_simulated", nullable = false)
    private Boolean isSimulated = Boolean.TRUE;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getLoanApplicationId() { return loanApplicationId; }
    public void setLoanApplicationId(String loanApplicationId) { this.loanApplicationId = loanApplicationId; }

    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }

    public BigDecimal getPrincipalAmount() { return principalAmount; }
    public void setPrincipalAmount(BigDecimal principalAmount) { this.principalAmount = principalAmount; }

    public BigDecimal getAnnualInterestRate() { return annualInterestRate; }
    public void setAnnualInterestRate(BigDecimal annualInterestRate) { this.annualInterestRate = annualInterestRate; }

    public Integer getDurationMonths() { return durationMonths; }
    public void setDurationMonths(Integer durationMonths) { this.durationMonths = durationMonths; }

    public BigDecimal getMonthlyInstallment() { return monthlyInstallment; }
    public void setMonthlyInstallment(BigDecimal monthlyInstallment) { this.monthlyInstallment = monthlyInstallment; }

    public BigDecimal getTotalRepayable() { return totalRepayable; }
    public void setTotalRepayable(BigDecimal totalRepayable) { this.totalRepayable = totalRepayable; }

    public BigDecimal getRemainingBalance() { return remainingBalance; }
    public void setRemainingBalance(BigDecimal remainingBalance) { this.remainingBalance = remainingBalance; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public OffsetDateTime getDisbursedAt() { return disbursedAt; }
    public void setDisbursedAt(OffsetDateTime disbursedAt) { this.disbursedAt = disbursedAt; }

    public Boolean getIsSimulated() { return isSimulated; }
    public void setIsSimulated(Boolean isSimulated) { this.isSimulated = isSimulated; }
}
