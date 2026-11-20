package cd.vmicro.credit.entity;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;

@Entity
@Table(name = "repayment_schedules")
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class RepaymentScheduleEntity {

    @Id
    @Column(length = 64, nullable = false)
    private String id;

    @Column(name = "contract_id", length = 64, nullable = false)
    private String contractId;

    @Column(name = "installment_number", nullable = false)
    private Integer installmentNumber;

    @Column(name = "due_date", nullable = false)
    private LocalDate dueDate;

    @Column(name = "principal_due", precision = 14, scale = 2, nullable = false)
    private BigDecimal principalDue;

    @Column(name = "interest_due", precision = 14, scale = 2, nullable = false)
    private BigDecimal interestDue;

    @Column(name = "total_due", precision = 14, scale = 2, nullable = false)
    private BigDecimal totalDue;

    @Column(name = "paid_amount", precision = 14, scale = 2, nullable = false)
    private BigDecimal paidAmount = BigDecimal.ZERO;

    @Column(length = 24, nullable = false)
    private String status = "PENDING";

    @Column(name = "paid_at")
    private OffsetDateTime paidAt;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getContractId() { return contractId; }
    public void setContractId(String contractId) { this.contractId = contractId; }

    public Integer getInstallmentNumber() { return installmentNumber; }
    public void setInstallmentNumber(Integer installmentNumber) { this.installmentNumber = installmentNumber; }

    public LocalDate getDueDate() { return dueDate; }
    public void setDueDate(LocalDate dueDate) { this.dueDate = dueDate; }

    public BigDecimal getPrincipalDue() { return principalDue; }
    public void setPrincipalDue(BigDecimal principalDue) { this.principalDue = principalDue; }

    public BigDecimal getInterestDue() { return interestDue; }
    public void setInterestDue(BigDecimal interestDue) { this.interestDue = interestDue; }

    public BigDecimal getTotalDue() { return totalDue; }
    public void setTotalDue(BigDecimal totalDue) { this.totalDue = totalDue; }

    public BigDecimal getPaidAmount() { return paidAmount; }
    public void setPaidAmount(BigDecimal paidAmount) { this.paidAmount = paidAmount; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public OffsetDateTime getPaidAt() { return paidAt; }
    public void setPaidAt(OffsetDateTime paidAt) { this.paidAt = paidAt; }
}
